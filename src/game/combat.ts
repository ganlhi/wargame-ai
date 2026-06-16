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

import { orientationToVector } from './movement'
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
): { position: { x: number; y: number }; orientation: number; isInIrons: boolean } {
  let { x, y } = pos
  let orient = orientation
  let irons = isInIrons

  if (irons) {
    const driftDir = (windDirection + 8) % 32
    const driftAngle = (driftDir * Math.PI / 16) - Math.PI / 2
    // driftSpeed is the total drift for a whole turn, split across the 5 chunks.
    const driftPerChunk = driftSpeed / 5
    x += Math.cos(driftAngle) * driftPerChunk
    y += Math.sin(driftAngle) * driftPerChunk
  } else {
    const vec = orientationToVector(orient)
    x += vec.dx * chunk.distance
    y += vec.dy * chunk.distance
  }

  if (irons) {
    const rel = ((windDirection - orient) % 32 + 32) % 32
    const norm = rel > 16 ? 32 - rel : rel
    const dir = norm >= 5 && norm <= 7
      ? (rel <= 16 ? 'starboard' : 'port')
      : (rel <= 4 ? 'port' : 'starboard')
    const pts = Math.ceil(maxTurnPoints / 2)
    orient = dir === 'port'
      ? (orient - pts + 32) % 32
      : (orient + pts) % 32
    const newAtt = computeAttitude(windDirection, orient)
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
    const result = simulateChunk(aiPos, aiOrient, aiIrons, chunk, windDirection, aiUnit.driftSpeed, aiUnit.maxTurnPoints)
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
          const puResult = simulateChunk(puPos, puOrient, puIrons, pc, windDirection, pu.driftSpeed, pu.maxTurnPoints)
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


