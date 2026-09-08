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

import { orientationToVector, driftVector } from './movement'

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
): { position: { x: number; y: number }; orientation: number } {
  let { x, y } = pos
  let orient = orientation

  if (isInIrons) {
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

  // Every turn, tack included, is carried by the plan itself, so there is no
  // separate in-irons swing to re-derive here. A tack resolves only at the end
  // of a turn, so drifting-or-sailing does not change part-way through.
  if (chunk.turn) {
    const dir = chunk.turn.direction === 'port' ? -1 : 1
    orient = (orient + dir * chunk.turn.points + 32) % 32
  }

  return { position: { x, y }, orientation: orient }
}

export function computeAIFirePlan(
  aiUnit: Unit,
  allUnits: Unit[],
  windDirection: number,
): { targetId: string; chunkIndex: number; arcSide: ArcSide } | null {
  /**
   * The heaviest arc that bears on `target` and is loaded by chunk `ci`. An arc
   * that fired on chunk N last turn is not loaded again until chunk N comes
   * round, and only that arc is held back — the other side can fire meanwhile.
   */
  function bestArcSide(
    firer: Unit,
    target: Unit,
    ci: number,
  ): { arcSide: ArcSide; weapons: number } | null {
    let best: { arcSide: ArcSide; weapons: number } | null = null
    const dist = distance(firer.position, target.position)
    const firerH = headingDeg(firer.orientation)
    const angleToTarget = angleBetweenPoints(firer.position, target.position)
    const relAngle = relativeAngle(firerH, angleToTarget)
    for (const arc of firer.firingArcs) {
      if (dist > arc.maxRange) continue
      const reloadedAt = firer.lastFireChunks[arc.side]
      if (reloadedAt !== undefined && ci < reloadedAt) continue
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
  const aiIrons = aiUnit.isInIrons || !!aiPlan.isTack

  for (let ci = 0; ci < aiPlan.chunks.length; ci++) {
    const chunk = aiPlan.chunks[ci]
    const result = simulateChunk(aiPos, aiOrient, aiIrons, chunk, windDirection, aiUnit.driftSpeed)
    aiPos = result.position
    aiOrient = result.orientation

    const simulatedAI: Unit = { ...aiUnit, position: aiPos, orientation: aiOrient, isInIrons: aiIrons }

    for (const pu of allUnits) {
      if (pu.side !== 'player' || pu.status === 'destroyed' || pu.status === 'surrendered') continue
      const puPlan = pu.playerOrder

      let puPos = pu.position
      let puOrient = pu.orientation
      const puIrons = pu.isInIrons || !!puPlan?.isTack

      if (puPlan) {
        for (let pci = 0; pci <= ci; pci++) {
          const puResult = simulateChunk(puPos, puOrient, puIrons, puPlan.chunks[pci], windDirection, pu.driftSpeed)
          puPos = puResult.position
          puOrient = puResult.orientation
        }
      }

      const simulatedPU: Unit = { ...pu, position: puPos, orientation: puOrient, isInIrons: puIrons }
      const best = bestArcSide(simulatedAI, simulatedPU, ci)
      if (best) {
        return { targetId: pu.id, chunkIndex: ci, arcSide: best.arcSide }
      }
    }
  }

  return null
}


