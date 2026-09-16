import type { Unit, ArcSide, MovementPlan, RangeBand } from '../types'
import { arcSideToAngles, arcBestBand, arcEffectiveGuns } from '../types'
import { distance, headingDeg, angleBetweenPoints, relativeAngle, inArc, isRakingAngle } from '../utils/geometry'
import { applyMovementPlan } from './movement'

/**
 * The AI does not decide when to fire — that is resolved at the table — but
 * the rulebook lets a ship fire during her move, so where she *could* fire
 * from is part of what a move is worth. This module answers one question for
 * the movement scorer: over the five steps of a plan, what is the heaviest
 * shot any arc would bring to bear on any enemy?
 */

export interface ShotOpportunity {
  targetId: string
  /** The step of the move (0–4) at whose end the shot is available. */
  chunkIndex: number
  arcSide: ArcSide
  /** The closest band the shot falls in — how good a shot it is. */
  band: RangeBand
  /** Guns bearing, each weighted by its band's to-hit modifier. */
  effectiveGuns: number
  /** Whether the target presents her bow or stern to the guns. */
  raking: boolean
}

/**
 * Raking multiplies what a shot is worth: the same guns firing down the length
 * of a hull do far more than into her side. It weights the choice between
 * opportunities, not the damage the players then roll.
 */
const RAKING_WEIGHT = 1.6

/**
 * The best shot `plan` offers `unit` against any of `enemies`: the heaviest
 * effective weight of metal at any step, raking counted for more, and the
 * earliest of equals. null when nothing bears in range at any step.
 *
 * The enemy is taken to stand where she was entered. By the time the AI is
 * asked, the player has already moved their ships for the turn, so what the
 * table shows is where they are.
 */
export function bestShotDuringMove(
  unit: Unit,
  plan: MovementPlan,
  enemies: Unit[],
  windDirection: number,
): ShotOpportunity | null {
  const targets = enemies.filter(
    (e) => e.side !== unit.side && e.status !== 'destroyed' && e.status !== 'surrendered',
  )
  if (targets.length === 0) return null

  // The same walk that draws the move places the base at the end of every
  // step, corner pivots included, so the shot is judged from where the guns
  // will actually be.
  const poses = applyMovementPlan(unit, plan, windDirection).poses

  let best: (ShotOpportunity & { weight: number }) | null = null

  for (let ci = 0; ci < plan.chunks.length; ci++) {
    // poses[0] is the opening pose, so the end of step ci is poses[ci + 1].
    const pose = poses[ci + 1]
    const from = { x: pose.x, y: pose.y }
    const heading = headingDeg(pose.orientation)

    for (const target of targets) {
      const dist = distance(from, target.position)
      const relAngle = relativeAngle(heading, angleBetweenPoints(from, target.position))
      const targetRelAngle = relativeAngle(
        headingDeg(target.orientation),
        angleBetweenPoints(target.position, from),
      )
      const raking = isRakingAngle(targetRelAngle)

      for (const arc of unit.firingArcs) {
        const band = arcBestBand(arc, dist)
        if (!band) continue
        const a = arcSideToAngles(arc.side)
        if (!inArc(relAngle, a.minAngle, a.maxAngle)) continue
        const effectiveGuns = arcEffectiveGuns(arc, dist)
        if (effectiveGuns <= 0) continue
        const weight = effectiveGuns * (raking ? RAKING_WEIGHT : 1)
        if (!best || weight > best.weight) {
          best = { targetId: target.id, chunkIndex: ci, arcSide: arc.side, band, effectiveGuns, raking, weight }
        }
      }
    }
  }

  if (!best) return null
  const { weight: _weight, ...shot } = best
  void _weight
  return shot
}
