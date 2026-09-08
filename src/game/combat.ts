import type { Unit, ArcSide } from '../types'
import { arcSideToAngles } from '../types'
import { distance, headingDeg, angleBetweenPoints, relativeAngle, inArc, isRakingAngle } from '../utils/geometry'

export interface FiringResult {
  inArc: boolean
  isBroadside: boolean
  isRaking: boolean
  dist: number
  arcSide: ArcSide | null
  weapons: number
}

import { orientationToVector, driftVector, getInIronsTurnDirection } from './movement'
import { computeAttitude } from '../utils/attitude'

export function checkFiringArc(firer: Unit, target: Unit): FiringResult {
  const dist = distance(firer.position, target.position)
  const firerHeading = headingDeg(firer.orientation)
  const angleToTarget = angleBetweenPoints(firer.position, target.position)
  const relAngle = relativeAngle(firerHeading, angleToTarget)
  const targetHeading = headingDeg(target.orientation)
  const targetRel = angleBetweenPoints(target.position, firer.position)
  const targetRelAngle = relativeAngle(targetHeading, targetRel)

  for (const arc of firer.firingArcs) {
    if (dist > arc.maxRange) continue
    const a = arcSideToAngles(arc.side)
    if (!inArc(relAngle, a.minAngle, a.maxAngle)) continue

    const broadside = arc.side === 'port' || arc.side === 'starboard'
    const raking = isRakingAngle(targetRelAngle)

    return { inArc: true, isBroadside: broadside, isRaking: raking, dist, arcSide: arc.side, weapons: arc.weapons || 1 }
  }

  return { inArc: false, isBroadside: false, isRaking: false, dist, arcSide: null, weapons: 0 }
}

function simulateChunk(
  pos: { x: number; y: number },
  orientation: number,
  isInIrons: boolean,
  chunk: { distance: number; turn?: { direction: 'port' | 'starboard'; points: number } },
  windDirection: number,
  driftSpeed: number,
  maxTurnPoints: number,
  foreAndAftRigged: boolean,
): { position: { x: number; y: number }; orientation: number; isInIrons: boolean } {
  let { x, y } = pos
  let orient = orientation
  let irons = isInIrons

  if (irons) {
    const drift = driftVector(windDirection)
    // driftSpeed is the total drift for a whole turn, split across the 5 chunks.
    const driftPerChunk = driftSpeed / 5
    x += drift.dx * driftPerChunk
    y += drift.dy * driftPerChunk
  } else {
    const vec = orientationToVector(orient)
    x += vec.dx * chunk.distance
    y += vec.dy * chunk.distance
  }

  if (irons) {
    // Shared with movement resolution rather than re-derived here: the two used
    // to hold separate copies of this, which the rig-dependent band boundary
    // would have silently pulled apart.
    const dir = getInIronsTurnDirection(orient, windDirection, foreAndAftRigged)
    const pts = Math.ceil(maxTurnPoints / 2)
    orient = dir === 'port'
      ? (orient - pts + 32) % 32
      : (orient + pts) % 32
    const newAtt = computeAttitude(windDirection, orient, foreAndAftRigged)
    if (newAtt === 'beating') irons = false
  } else if (chunk.turn) {
    const dir = chunk.turn.direction === 'port' ? -1 : 1
    orient = (orient + dir * chunk.turn.points + 32) % 32
  }

  return { position: { x, y }, orientation: orient, isInIrons: irons }
}

export function computeAIFirePlan(
  aiUnit: Unit,
  allUnits: Unit[],
  windDirection: number,
): { targetId: string; chunkIndex: number; arcSide: ArcSide } | null {
  function bestArcSide(firer: Unit, target: Unit): { arcSide: ArcSide; weapons: number } | null {
    let best: { arcSide: ArcSide; weapons: number } | null = null
    const dist = distance(firer.position, target.position)
    const firerH = headingDeg(firer.orientation)
    const angleToTarget = angleBetweenPoints(firer.position, target.position)
    const relAngle = relativeAngle(firerH, angleToTarget)
    for (const arc of firer.firingArcs) {
      if (dist > arc.maxRange) continue
      const a = arcSideToAngles(arc.side)
      if (!inArc(relAngle, a.minAngle, a.maxAngle)) continue
      const weapons = arc.weapons || 1
      if (!best || weapons > best.weapons) {
        best = { arcSide: arc.side, weapons }
      }
    }
    return best
  }
  const aiPlan = aiUnit.hiddenAIOrder
  if (!aiPlan) return null

  let aiPos = aiUnit.position
  let aiOrient = aiUnit.orientation
  let aiIrons = aiUnit.isInIrons

  for (let ci = 0; ci < aiPlan.chunks.length; ci++) {
    const chunk = aiPlan.chunks[ci]
    const result = simulateChunk(aiPos, aiOrient, aiIrons, chunk, windDirection, aiUnit.driftSpeed, aiUnit.maxTurnPoints, aiUnit.foreAndAftRigged)
    aiPos = result.position
    aiOrient = result.orientation
    aiIrons = result.isInIrons

    if (aiUnit.lastFireChunk !== null && ci < aiUnit.lastFireChunk) continue

    const simulatedAI: Unit = { ...aiUnit, position: aiPos, orientation: aiOrient, isInIrons: aiIrons }

    for (const pu of allUnits) {
      if (pu.side !== 'player' || pu.status === 'destroyed' || pu.status === 'surrendered') continue
      const puPlan = pu.playerOrder

      let puPos: { x: number; y: number }
      let puOrient: number
      let puIrons: boolean

      if (puPlan) {
        puPos = pu.position
        puOrient = pu.orientation
        puIrons = pu.isInIrons
        for (let pci = 0; pci <= ci; pci++) {
          const pc = puPlan.chunks[pci]
          const puResult = simulateChunk(puPos, puOrient, puIrons, pc, windDirection, pu.driftSpeed, pu.maxTurnPoints, pu.foreAndAftRigged)
          puPos = puResult.position
          puOrient = puResult.orientation
          puIrons = puResult.isInIrons
        }
      } else {
        puPos = pu.position
        puOrient = pu.orientation
        puIrons = pu.isInIrons
      }

      const simulatedPU: Unit = { ...pu, position: puPos, orientation: puOrient, isInIrons: puIrons }
      const best = bestArcSide(simulatedAI, simulatedPU)
      if (best) {
        return { targetId: pu.id, chunkIndex: ci, arcSide: best.arcSide }
      }
    }
  }

  return null
}


