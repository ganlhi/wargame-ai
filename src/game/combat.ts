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

import { applyMovementPlan } from './movement'

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

  // Both sides are walked by the one movement routine, so the shot is judged
  // from exactly where each base will sit — corner pivots included — at the
  // end of every chunk. Every turn, tack included, is carried by the plan
  // itself; a tack resolves only at the end of a turn, so drifting-or-sailing
  // does not change part-way through.
  const aiIrons = aiUnit.isInIrons || !!aiPlan.isTack
  const aiPoses = applyMovementPlan(aiUnit, aiPlan, windDirection).poses

  const players = allUnits
    .filter((pu) => pu.side === 'player' && pu.status !== 'destroyed' && pu.status !== 'surrendered')
    .map((pu) => ({
      unit: pu,
      isInIrons: pu.isInIrons || !!pu.playerOrder?.isTack,
      poses: pu.playerOrder ? applyMovementPlan(pu, pu.playerOrder, windDirection).poses : null,
    }))

  const candidates: Candidate[] = []
  // Range to each target as the move ends, so a shot can be judged against
  // where the ship is heading and not only against where she is now.
  const finalRange = new Map<string, number>()

  for (let ci = 0; ci < aiPlan.chunks.length; ci++) {
    // poses[0] is the opening pose, so the end of chunk ci is poses[ci + 1].
    const aiPose = aiPoses[ci + 1]
    const aiPos = { x: aiPose.x, y: aiPose.y }
    const simulatedAI: Unit = { ...aiUnit, position: aiPos, orientation: aiPose.orientation, isInIrons: aiIrons }

    for (const { unit: pu, isInIrons: puIrons, poses } of players) {
      const puPose = poses ? poses[ci + 1] : { x: pu.position.x, y: pu.position.y, orientation: pu.orientation }
      const puPos = { x: puPose.x, y: puPose.y }
      const simulatedPU: Unit = { ...pu, position: puPos, orientation: puPose.orientation, isInIrons: puIrons }
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
