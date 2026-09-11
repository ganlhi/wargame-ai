import type { Unit, ArcSide, FirePlan, RangeBand } from '../types'
import { arcSideToAngles, arcBestBand, arcEffectiveGuns } from '../types'
import { distance, headingDeg, angleBetweenPoints, relativeAngle, inArc, isRakingAngle } from '../utils/geometry'

export interface FiringResult {
  inArc: boolean
  isBroadside: boolean
  isRaking: boolean
  dist: number
  arcSide: ArcSide | null
  /** Band the target falls in for the bearing arc; null when nothing bears. */
  band: RangeBand | null
  /** Guns bearing, each weighted by its band's to-hit modifier. */
  effectiveGuns: number
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
    const band = arcBestBand(arc, dist)
    if (!band) continue
    const a = arcSideToAngles(arc.side)
    if (!inArc(relAngle, a.minAngle, a.maxAngle)) continue

    const broadside = arc.side === 'port' || arc.side === 'starboard'
    const raking = isRakingAngle(targetRelAngle)

    return {
      inArc: true,
      isBroadside: broadside,
      isRaking: raking,
      dist,
      arcSide: arc.side,
      band,
      effectiveGuns: arcEffectiveGuns(arc, dist),
    }
  }

  return {
    inArc: false, isBroadside: false, isRaking: false, dist,
    arcSide: null, band: null, effectiveGuns: 0,
  }
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

interface Candidate extends FirePlan {
  /** What the shot is worth to the AI: effective guns, raking counted for more. */
  weight: number
  /** Range at the moment of firing, kept so a poor shot can be held. */
  dist: number
}

/**
 * Raking multiplies what a shot is worth: the same guns firing down the length
 * of a hull do far more than into her side. It only weights the AI's choice
 * between candidate shots, not the damage the players then roll.
 */
const RAKING_WEIGHT = 1.6

export function computeAIFirePlan(
  aiUnit: Unit,
  allUnits: Unit[],
  windDirection: number,
): FirePlan | null {
  const aiPlan = aiUnit.hiddenAIOrder
  if (!aiPlan) return null

  /**
   * Every shot `firer` could take at `target` from this pose, one per arc that
   * bears, weighted by the band the range falls in. An arc that fired on chunk N last turn is not
   * loaded again until chunk N comes round, and only that arc is held back —
   * the other side can fire meanwhile.
   */
  function shotsAt(firer: Unit, target: Unit, ci: number): Candidate[] {
    const out: Candidate[] = []
    const dist = distance(firer.position, target.position)
    const firerH = headingDeg(firer.orientation)
    const relAngle = relativeAngle(firerH, angleBetweenPoints(firer.position, target.position))
    const targetRelAngle = relativeAngle(
      headingDeg(target.orientation),
      angleBetweenPoints(target.position, firer.position),
    )
    const raking = isRakingAngle(targetRelAngle)

    for (const arc of firer.firingArcs) {
      const reloadedAt = firer.lastFireChunks[arc.side]
      if (reloadedAt !== undefined && ci < reloadedAt) continue
      const band = arcBestBand(arc, dist)
      if (!band) continue
      const a = arcSideToAngles(arc.side)
      if (!inArc(relAngle, a.minAngle, a.maxAngle)) continue
      const effectiveGuns = arcEffectiveGuns(arc, dist)
      if (effectiveGuns <= 0) continue
      out.push({
        targetId: target.id,
        chunkIndex: ci,
        arcSide: arc.side,
        band,
        effectiveGuns,
        weight: effectiveGuns * (raking ? RAKING_WEIGHT : 1),
        dist,
      })
    }
    return out
  }

  let aiPos = aiUnit.position
  let aiOrient = aiUnit.orientation
  const aiIrons = aiUnit.isInIrons || !!aiPlan.isTack

  const candidates: Candidate[] = []
  // Range to each target as the move ends, so a shot can be judged against
  // where the ship is heading and not only against where she is now.
  const finalRange = new Map<string, number>()

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
      finalRange.set(pu.id, distance(aiPos, puPos))
      candidates.push(...shotsAt(simulatedAI, simulatedPU, ci))
    }
  }

  if (candidates.length === 0) return null

  // A ship fires one arc per turn, so which chunk she fires on is a real
  // decision rather than a matter of taking the first thing that bears: a
  // broadside at extreme range lands a fourteenth of what the same broadside
  // lands at close quarters. Take the heaviest shot the turn offers, and the
  // earliest of equals — firing early also means the arc is loaded again early
  // next turn.
  let best = candidates[0]
  for (const c of candidates) {
    if (c.weight > best.weight) best = c
  }

  // Hold fire rather than spend a loaded arc on a shot barely worth the powder
  // — but only while the move is still closing on that target, so a ship that
  // will never get nearer than extreme range still fires what she has.
  const closing = (finalRange.get(best.targetId) ?? Infinity) < best.dist
  if (best.band === 'extreme' && closing) return null

  return {
    targetId: best.targetId,
    chunkIndex: best.chunkIndex,
    arcSide: best.arcSide,
    band: best.band,
    effectiveGuns: best.effectiveGuns,
  }
}
