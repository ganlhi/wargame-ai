import type { Unit, MovementPlan, TableTerrain, Attitude, RangeBand } from '../types'
import { arcSideToAngles, arcMaxRange, arcEffectiveGuns, RANGE_BANDS } from '../types'
import {
  enumerateMovementPlans, applyMovementPlan, orientationToVector, driftVector,
  projectTackCompletion, topSpeed,
} from './movement'
import { bestShotDuringMove } from './combat'
import type { Point } from '../utils/geometry'
import {
  distance, headingDeg, angleBetweenPoints, relativeAngle, inArc, isRakingAngle,
  baseCorners, polygonsIntersect, polygonDistance,
  terrainPolygon, pointInPolygon, pointPolygonEdgeDistance,
} from '../utils/geometry'

// How close two bases have to be for the ships to count as in contact — the
// range at which the rulebook lets them grapple, which the player resolves
// at the table. Centre-to-centre distance is unreachable once ship bases are
// accounted for, so contact is measured as the gap between the two bases.
export const CONTACT_RANGE = 20

/** Shortest gap (mm) between two ships' bases; 0 when their bases overlap. */
export function baseGap(a: Unit, b: Unit): number {
  return polygonDistance(
    baseCorners(a.position, a.orientation, a.baseWidth, a.baseLength),
    baseCorners(b.position, b.orientation, b.baseWidth, b.baseLength),
  )
}

/** Whether two ships are in contact: bases within CONTACT_RANGE of each other. */
export function basesInContact(a: Unit, b: Unit): boolean {
  return baseGap(a, b) <= CONTACT_RANGE
}
const TERRAIN_DANGER = 30
const TERRAIN_PENALTY_MULT = 0.5

const LOOKAHEAD_DISCOUNT = 0.5

// The table is infinite, so nothing physically stops a ship from sailing away
// for ever. What replaces the old table-edge penalty is a soft leash: past a
// multiple of the longest gun range in play there is no more to be gained by
// opening the range, so withdrawing further starts to cost. A defensive unit
// disengages to the edge of usefulness and then holds station there instead of
// vanishing off into the room.
const LEASH_MULT = 1.5
const LEASH_PENALTY_MULT = 0.5
// Used when neither ship has any armament to derive a range from.
const LEASH_FALLBACK_RANGE = 400

// What a plan is worth for the shot it offers along the way. `scoreFiring`
// only looks at where the turn ends, but the rulebook lets a ship fire during
// her move — so a plan can score well on its final pose and still offer
// nothing, which is how ships ended up turning a bearing broadside away from
// a target at point-blank range. The AI does not itself decide to fire; this
// term only sees to it that the player has a shot to resolve.
const FIRE_SOLUTION_PER_GUN = 4

// What an enemy gun bearing on the ship costs, per effective gun, by how much
// the style minds being shot at. The scale is the same as FIRE_SOLUTION_PER_GUN
// so a broadside exchange is judged gun for gun: an aggressive ship accepts a
// broadside to land one, a defensive ship will not.
const ENEMY_GUN_PENALTY: Record<string, number> = {
  aggressive: 2,
  cautious: 4,
  defensive: 6,
}
// Being raked is worse than being hit in the side, by the same factor the
// AI's own raking shots are prized.
const RAKED_PENALTY_MULT = 1.6

// Way made is worth very little in itself. These are tie-breakers between
// plans that are otherwise as good — enough that a ship sails rather than
// dawdles, never enough to outweigh a shot, a threat or a range the style
// cares about. (A full run is some 250mm; a close-range broadside of 14 guns
// scores 56 through FIRE_SOLUTION_PER_GUN.)
const MOVE_TIE_BREAKER = 0.02
const CLOSING_WEIGHT: Record<string, number> = {
  aggressive: 0.15,
  cautious: 0.08,
  defensive: 0.1,
}

// What coming about is worth, per broadside gun that would bear once the tack
// is complete. A tack costs several turns in irons, so it has to be paid for by
// the position it buys; these are per-gun, discounted per turn the tack takes.
const TACK_BROADSIDE_CLOSE = 14
const TACK_BROADSIDE_MEDIUM = 7
const TACK_RAKING_BONUS = 20
// Closing to short range is the point of the manoeuvre, which suits a ship
// looking for a fight far more than one trying to stay out of one.
const TACK_STYLE_MULT: Record<string, number> = {
  aggressive: 1,
  cautious: 1,
  defensive: 0.25,
}

function maxFiringRange(unit: Unit): number {
  return unit.firingArcs.reduce((max, a) => Math.max(max, arcMaxRange(a)), 0)
}

type RangeTiers = Record<RangeBand, number>

/**
 * The outer edge of each band across everything a ship carries — her longest
 * close range, her longest medium range, and so on. null when she has no guns
 * entered at all.
 */
function ownRangeTiers(unit: Unit): RangeTiers | null {
  const tiers: RangeTiers = { point_blank: 0, close: 0, medium: 0, long: 0, extreme: 0 }
  let any = false
  for (const arc of unit.firingArcs) {
    for (const profile of arc.guns) {
      if (profile.guns <= 0) continue
      any = true
      for (const band of RANGE_BANDS) {
        tiers[band] = Math.max(tiers[band], profile.ranges[band])
      }
    }
  }
  return any ? tiers : null
}

// Neither ship has a gun entered: fall back to bands scaled off the same
// nominal reach the disengagement leash uses, so the style logic still has
// meaningful distances to work with.
const DEFAULT_RANGE_TIERS: RangeTiers = {
  point_blank: LEASH_FALLBACK_RANGE * 0.05,
  close: LEASH_FALLBACK_RANGE * 0.2,
  medium: LEASH_FALLBACK_RANGE * 0.4,
  long: LEASH_FALLBACK_RANGE * 0.7,
  extreme: LEASH_FALLBACK_RANGE,
}

/**
 * The bands the AI judges its distance from `enemy` by. Preferably the enemy's
 * own reach — how far away is far enough to be safe is a question about their
 * guns. Every ship carries a gun layout, but one entered without any falls
 * back to the AI's own bands, which are at least the right order of magnitude
 * for the engagement.
 */
function getRangeTiers(enemy: Unit, self: Unit): RangeTiers {
  return ownRangeTiers(enemy) ?? ownRangeTiers(self) ?? DEFAULT_RANGE_TIERS
}

function getEngageableWeapons(
  firer: Unit,
  firerHeading: number,
  target: Unit,
): { totalWeapons: number; broadsideWeapons: number; isRaking: boolean } {
  const dist = distance(firer.position, target.position)
  const angleToTarget = angleBetweenPoints(firer.position, target.position)
  const relAngle = relativeAngle(firerHeading, angleToTarget)
  const targetHeading = headingDeg(target.orientation)
  const targetRelAngle = relativeAngle(targetHeading, angleBetweenPoints(target.position, firer.position))

  let totalWeapons = 0
  let broadsideWeapons = 0
  let isRaking = false

  for (const arc of firer.firingArcs) {
    // Guns count for what they would actually land at this range rather than
    // by the barrel: a broadside at extreme range is worth a fourteenth of the
    // same broadside at close quarters, which is what makes closing worth doing.
    const weapons = arcEffectiveGuns(arc, dist)
    if (weapons <= 0) continue
    const a = arcSideToAngles(arc.side)
    if (!inArc(relAngle, a.minAngle, a.maxAngle)) continue

    totalWeapons += weapons
    if (arc.side === 'port' || arc.side === 'starboard') {
      broadsideWeapons += weapons
    }
    if (isRakingAngle(targetRelAngle)) {
      isRaking = true
    }
  }

  return { totalWeapons, broadsideWeapons, isRaking }
}

function getTotalEnemyWeaponsInArc(unit: Unit, enemies: Unit[]): {
  totalWeapons: number
  broadsideWeapons: number
  anyRaking: boolean
} {
  const h = headingDeg(unit.orientation)
  let totalWeapons = 0
  let broadsideWeapons = 0
  let anyRaking = false

  for (const e of enemies) {
    const result = getEngageableWeapons(unit, h, e)
    totalWeapons += result.totalWeapons
    broadsideWeapons += result.broadsideWeapons
    if (result.isRaking) anyRaking = true
  }

  return { totalWeapons, broadsideWeapons, anyRaking }
}

function isEnemyBroadsideOnUnit(unit: Unit, enemy: Unit): boolean {
  const eh = headingDeg(enemy.orientation)
  const angleFromEnemy = angleBetweenPoints(enemy.position, unit.position)
  const enemyRel = relativeAngle(eh, angleFromEnemy)
  const portArc = arcSideToAngles('port')
  const starboardArc = arcSideToAngles('starboard')
  return inArc(enemyRel, portArc.minAngle, portArc.maxAngle) ||
         inArc(enemyRel, starboardArc.minAngle, starboardArc.maxAngle)
}

// Terrain pieces are primitives (circle / ellipse / rectangle); discretising
// each one once keeps a single polygon code path without re-tessellating on
// every one of the hundreds of candidate plans scored per turn. Terrain objects
// are replaced rather than mutated by the store, so identity is a safe key.
const terrainPolygonCache = new WeakMap<TableTerrain, Point[]>()

function polygonOf(t: TableTerrain): Point[] {
  let poly = terrainPolygonCache.get(t)
  if (!poly) {
    poly = terrainPolygon(t)
    terrainPolygonCache.set(t, poly)
  }
  return poly
}

function pointInTerrain(p: Point, terrain: TableTerrain[]): boolean {
  return terrain.some((t) => pointInPolygon(p, polygonOf(t)))
}

function minEdgeDistance(pos: Point, terrain: TableTerrain[]): number {
  let minDist = Infinity
  for (const t of terrain) {
    const d = pointPolygonEdgeDistance(pos, polygonOf(t))
    if (d < minDist) minDist = d
  }
  return minDist
}

// Reward ending the turn on a fast point of sail so the AI actually exploits
// the wind. The reward is deliberately modest (ATTITUDE_WEIGHT is small next to
// the firing/distance/positional terms): being on a slower attitude at the end
// of a turn can still be worth it if it sets up a stronger position in the turns
// that follow — including deliberately turning into irons to switch tack. That
// longer-term payoff is carried by the positional scores and the 2-ply
// lookahead, so this term only needs to break ties in favour of speed, not
// override repositioning.
const ATTITUDE_WEIGHT = 20

// Canonical best-to-worst ordering from CLAUDE.md, used only when a ship's
// speed profile is flat (no information to rank attitudes by).
const DEFAULT_ATTITUDE_RANK: Record<Attitude, number> = {
  quarter_reaching: 1,
  running: 0.75,
  reaching: 0.5,
  beating: 0.25,
  in_irons: 0,
}

function scoreAttitude(unit: Unit): number {
  const speeds = Object.values(unit.speedProfile).map((r) => r.max)
  const maxSpeed = Math.max(...speeds, 0)
  // Normalise to the ship's own best point of sail so the weight is comparable
  // across ships with different absolute speeds.
  const rank =
    maxSpeed > 0
      ? unit.speedProfile[unit.attitude].max / maxSpeed
      : DEFAULT_ATTITUDE_RANK[unit.attitude]
  return ATTITUDE_WEIGHT * rank
}

function scoreFiring(unit: Unit, enemies: Unit[]): number {
  const { broadsideWeapons, anyRaking } = getTotalEnemyWeaponsInArc(unit, enemies)
  return broadsideWeapons * 2 + (anyRaking ? 15 : 0)
}

function scoreDistanceByStyle(unit: Unit, enemies: Unit[]): number {
  if (enemies.length === 0) return 0
  let score = 0

  for (const e of enemies) {
    const dist = distance(unit.position, e.position)
    const { close, medium, long } = getRangeTiers(e, unit)

    switch (unit.aiStyle) {
      case 'aggressive': {
        if (basesInContact(unit, e)) score += 80
        else if (dist < close) score += 50
        else if (dist < medium) score += 20
        else score -= Math.floor(dist / 100) * 5
        break
      }
      case 'cautious': {
        if (dist >= medium && dist <= long) score += 50
        else if (dist < close) score -= 30
        else if (dist < medium) score -= 10
        else score -= 15
        break
      }
      case 'defensive': {
        if (dist > long) score += 60
        else if (dist > medium) score += 20
        else if (dist < close) score -= 50
        else score -= 20
        break
      }
    }
  }

  return score
}

/**
 * Penalise withdrawing beyond the point where distance still buys anything.
 * The leash is measured against the nearest enemy and sized from the longest
 * gun range either ship brings, so it scales with the engagement rather than
 * with a table that no longer exists.
 */
function scoreDisengagementLeash(unit: Unit, enemies: Unit[]): number {
  if (enemies.length === 0) return 0

  const nearest = enemies.reduce((a, b) =>
    distance(unit.position, a.position) < distance(unit.position, b.position) ? a : b,
  )
  const dist = distance(unit.position, nearest.position)
  const reach = Math.max(maxFiringRange(unit), maxFiringRange(nearest), LEASH_FALLBACK_RANGE)
  const leash = reach * LEASH_MULT

  if (dist <= leash) return 0
  return -(dist - leash) * LEASH_PENALTY_MULT
}

function scoreTerrainProximity(pos: Point, terrain: TableTerrain[]): number {
  if (terrain.length === 0) return 0

  if (pointInTerrain(pos, terrain)) {
    return -(TERRAIN_DANGER + 30) * TERRAIN_PENALTY_MULT
  }

  let penalty = 0
  for (const t of terrain) {
    const minEdgeDist = pointPolygonEdgeDistance(pos, polygonOf(t))
    if (minEdgeDist < TERRAIN_DANGER) {
      penalty -= (TERRAIN_DANGER - minEdgeDist) * TERRAIN_PENALTY_MULT
    }
  }
  return penalty
}

/**
 * What the enemy would land on the ship from here: every enemy gun that bears
 * on her, counted at its band's modifier — the same measure her own shots are
 * weighed by — and worse if it would rake her. How much that costs depends on
 * the style: a defensive ship is here to avoid exactly this, an aggressive one
 * takes it as the price of closing.
 */
function scoreEnemyBroadsideDanger(unit: Unit, enemies: Unit[]): number {
  let penalty = 0
  for (const e of enemies) {
    const onUs = getEngageableWeapons(e, headingDeg(e.orientation), unit)
    if (onUs.totalWeapons <= 0) continue
    penalty -= onUs.totalWeapons * (ENEMY_GUN_PENALTY[unit.aiStyle] ?? 4) * (onUs.isRaking ? RAKED_PENALTY_MULT : 1)
  }
  return penalty
}

function scoreStyleSpecific(unit: Unit, enemies: Unit[]): number {
  if (enemies.length === 0) return 0
  let bonus = 0
  const h = headingDeg(unit.orientation)

  for (const e of enemies) {
    const dist = distance(unit.position, e.position)
    const { close, medium, long } = getRangeTiers(e, unit)
    const weapons = getEngageableWeapons(unit, h, e)

    switch (unit.aiStyle) {
      case 'aggressive': {
        if (basesInContact(unit, e)) bonus += 40
        if (weapons.isRaking) bonus += weapons.totalWeapons * 0.6
        else if (weapons.broadsideWeapons > 0) bonus += weapons.broadsideWeapons * 0.4
        break
      }
      case 'cautious': {
        if (weapons.isRaking && dist >= medium && dist <= long) bonus += weapons.totalWeapons * 2
        else if (weapons.broadsideWeapons > 0 && dist >= medium && dist <= long) bonus += weapons.broadsideWeapons * 1.5
        if (weapons.totalWeapons > 0 && dist < close) bonus -= weapons.totalWeapons * 0.5
        if (weapons.totalWeapons === 0 && dist > long) bonus -= 15
        break
      }
      case 'defensive': {
        if (dist < close) bonus -= 30
        if (isEnemyBroadsideOnUnit(unit, e)) bonus -= 25
        if (dist > long) bonus += 30
        break
      }
    }
  }

  return bonus
}

/**
 * What a declared tack is worth, judged by where it ends rather than where it
 * starts.
 *
 * On the turn a tack is declared the ship is in irons, drifting, making no way
 * and pointing nowhere useful — scored on its own terms it is always among the
 * worst plans available, so the AI would never come about. What makes it worth
 * doing is the position on the far tack: reward a tack that finishes with a
 * broadside bearing on an enemy at short range, discounted for every turn spent
 * getting there.
 */
export function scoreTack(
  unit: Unit,
  enemies: Unit[],
  terrain: TableTerrain[],
  windDirection: number,
): number {
  if (enemies.length === 0) return 0

  const outcome = projectTackCompletion(unit, windDirection)
  if (!outcome.completed || outcome.turns === 0) return 0
  // Drifting onto a shoal is not a position worth buying.
  if (pointInTerrain(outcome.position, terrain)) return 0

  const finished: Unit = { ...unit, position: outcome.position, orientation: outcome.orientation }
  const heading = headingDeg(outcome.orientation)
  const { close, medium } = getRangeTiers(finished, finished)

  let best = 0
  for (const enemy of enemies) {
    // The enemy will not oblige by sitting still: carry it forward at cruising
    // speed for as long as the tack takes — the same guess the 2-ply lookahead
    // already makes, just repeated.
    let position = enemy.position
    for (let turn = 0; turn < outcome.turns; turn++) {
      position = projectNextPosition(enemy, { ...enemy, position }, windDirection)
    }
    const projected: Unit = { ...enemy, position }

    const { broadsideWeapons, isRaking } = getEngageableWeapons(finished, heading, projected)
    if (broadsideWeapons === 0) continue

    const dist = distance(outcome.position, position)
    if (dist > medium) continue

    const perGun = dist <= close ? TACK_BROADSIDE_CLOSE : TACK_BROADSIDE_MEDIUM
    best = Math.max(best, broadsideWeapons * perGun + (isRaking ? TACK_RAKING_BONUS : 0))
  }

  return best * (TACK_STYLE_MULT[unit.aiStyle] ?? 1) * LOOKAHEAD_DISCOUNT ** (outcome.turns - 1)
}

/**
 * The heaviest shot this plan offers along the way, and what it is worth.
 *
 * Judged by the same walk the reveal will draw, from the base's pose at the
 * end of every step, so a plan is scored on the shot it really gives rather
 * than on the arc that happens to bear once the move is over.
 */
function scoreFiringOpportunity(
  unit: Unit,
  plan: MovementPlan,
  enemies: Unit[],
  windDirection: number,
): number {
  const shot = bestShotDuringMove(unit, plan, enemies, windDirection)
  return shot ? shot.effectiveGuns * FIRE_SOLUTION_PER_GUN : 0
}

export function evaluatePosition(
  unit: Unit,
  enemies: Unit[],
  terrain: TableTerrain[],
): number {
  let score = 0

  score += scoreAttitude(unit)
  score += scoreFiring(unit, enemies)
  score += scoreDistanceByStyle(unit, enemies)
  score += scoreStyleSpecific(unit, enemies)
  score += scoreDisengagementLeash(unit, enemies)
  score += scoreTerrainProximity(unit.position, terrain)
  score += scoreEnemyBroadsideDanger(unit, enemies)

  return score
}

function selectPlan(
  plans: MovementPlan[],
  scores: number[],
  difficulty: number,
): MovementPlan | null {
  if (plans.length === 0) return null
  if (plans.length === 1) return plans[0]

  if (difficulty <= 0) {
    return plans[Math.floor(Math.random() * plans.length)]
  }

  if (difficulty >= 1) {
    const best = Math.max(...scores)
    const bestIdx = scores.indexOf(best)
    return plans[bestIdx]
  }

  const minS = Math.min(...scores)
  const maxS = Math.max(...scores)
  const range = maxS - minS || 1

  const noisy = scores.map((s) => s + (Math.random() - 0.5) * range * (1 - difficulty) * 2)
  const bestNoisy = Math.max(...noisy)
  return plans[noisy.indexOf(bestNoisy)]
}

/**
 * Where `unit` would be a turn from now if she carried on as she is: half her
 * top speed for the point of sail — the ship's own multiplier included — or,
 * head to wind, a turn's worth of drift to leeward. A guess, but the same guess
 * the AI makes about every ship, itself included.
 */
function projectNextPosition(
  unit: Unit,
  pose: { position: Point; orientation: number; attitude: Attitude; isInIrons: boolean },
  windAngle: number,
): Point {
  const { position, orientation, attitude, isInIrons } = pose
  if (isInIrons) {
    const drift = driftVector(windAngle)
    // driftSpeed is the total drift for a whole turn; this projects one turn ahead.
    const driftSpeed = unit.driftSpeed ?? 10
    return {
      x: position.x + drift.dx * driftSpeed,
      y: position.y + drift.dy * driftSpeed,
    }
  }
  const midSpeed = Math.round(topSpeed(unit, attitude) / 2)
  const vec = orientationToVector(orientation)
  return {
    x: position.x + vec.dx * midSpeed,
    y: position.y + vec.dy * midSpeed,
  }
}

export function suggestMovement(
  unit: Unit,
  allUnits: Unit[],
  terrain: TableTerrain[],
  windDirection: number,
  prevAttitude: Attitude | null,
  difficulty = 1,
): MovementPlan | null {
  if (unit.status === 'destroyed' || unit.status === 'surrendered') {
    return null
  }

  const enemies = allUnits.filter(
    (u) => u.side !== unit.side && u.status !== 'destroyed' && u.status !== 'surrendered',
  )

  if (unit.status === 'immobilised') {
    const idlePlan: MovementPlan = {
      chunks: [
        { distance: 0 }, { distance: 0 }, { distance: 0 }, { distance: 0 }, { distance: 0 },
      ],
      totalTurnPoints: 0,
      effectiveMaxSpeed: 0,
    }
    const newState = applyMovementPlan(unit, idlePlan, windDirection)
    const testUnit: Unit = { ...unit, ...newState }
    const score = evaluatePosition(testUnit, enemies, terrain)
    return selectPlan([idlePlan], [score], difficulty)
  }

  const plans = enumerateMovementPlans(unit, windDirection, prevAttitude)

  if (plans.length === 0) return null

  const TERRAIN_RELIEF_BONUS = 0.3
  const currentTerrainDist = terrain.length > 0 ? minEdgeDistance(unit.position, terrain) : Infinity

  // Footprints of every other ship at its current pose. The AI must never plan a
  // move that drives its own base through (or to rest overlapping) one of these.
  // All ships count, regardless of status — a wreck is still a model on the table.
  const otherFootprints = allUnits
    .filter((u) => u.id !== unit.id && u.baseWidth > 0 && u.baseLength > 0)
    .map((u) => baseCorners(u.position, u.orientation, u.baseWidth, u.baseLength))

  const hasBase = unit.baseWidth > 0 && unit.baseLength > 0
  const poseCollides = (p: { x: number; y: number; orientation: number }): boolean => {
    if (!hasBase || otherFootprints.length === 0) return false
    const fp = baseCorners(p, p.orientation, unit.baseWidth, unit.baseLength)
    return otherFootprints.some((of) => polygonsIntersect(fp, of))
  }

  const planCollides: boolean[] = []
  const planScores = plans.map((plan) => {
    const newState = applyMovementPlan(unit, plan, windDirection)
    // Reject the plan if the base touches another ship at any point along the
    // swept path (waypoints), not just at the final resting pose.
    planCollides.push(newState.sweptPoses.some(poseCollides))
    const testUnit: Unit = { ...unit, ...newState, attitude: newState.attitude }
    let score = evaluatePosition(testUnit, enemies, terrain)
    if (plan.isTack) {
      // Scored on the turn it starts a tack is always among the worst options,
      // so it is judged by the position it ends in instead.
      score += scoreTack(unit, enemies, terrain, windDirection)
    }
    if (terrain.length > 0) {
      const newDist = minEdgeDistance(newState.position, terrain)
      if (newDist > currentTerrainDist) {
        score += (newDist - currentTerrainDist) * TERRAIN_RELIEF_BONUS
      }
    }

    // How far the ship went, and which way. A turn pivots the base on its rear
    // corner, so the centre can shift a base-length or so without any way
    // being made; that shift is real and evaluatePosition already prices the
    // position it produces, but the terms below reward *sailing* toward or
    // away from the enemy, so they weigh the distance actually sailed. Left
    // on the raw displacement they would pay an aggressive ship to crawl a
    // few millimetres and swing hard, just for the sideways slide.
    const dx = newState.position.x - unit.position.x
    const dy = newState.position.y - unit.position.y
    const displacement = Math.sqrt(dx * dx + dy * dy)
    const moveDist = newState.distanceTraveled

    if (enemies.length > 0) {
      const nearestEnemy = enemies.reduce((a, b) =>
        distance(newState.position, a.position) < distance(newState.position, b.position) ? a : b,
      )
      const toEnemyX = nearestEnemy.position.x - unit.position.x
      const toEnemyY = nearestEnemy.position.y - unit.position.y

      if (moveDist > 0 && displacement > 0) {
        const toEnemyDist = Math.sqrt(toEnemyX * toEnemyX + toEnemyY * toEnemyY)
        const dot = (dx * toEnemyX + dy * toEnemyY) / (displacement * toEnemyDist)

        const weight = CLOSING_WEIGHT[unit.aiStyle] ?? 0.1
        if (unit.aiStyle === 'defensive') {
          const curDist = distance(unit.position, nearestEnemy.position)
          const newDist = distance(newState.position, nearestEnemy.position)
          score += (newDist - curDist) * weight
        } else if (unit.aiStyle === 'cautious') {
          // Closing counts, but so does standing across the enemy's course.
          score += dot * moveDist * weight
          score += (1 - Math.abs(dot)) * moveDist * (weight / 3)
        } else {
          score += dot * moveDist * weight
        }
      }
    }

    score += moveDist * MOVE_TIE_BREAKER

    // Score the plan on the shot it actually offers, not just on the arc that
    // happens to bear once the turn is over.
    score += scoreFiringOpportunity(unit, plan, enemies, windDirection)

    const projectedPos = projectNextPosition(unit, newState, windDirection)

    if (enemies.length > 0) {
      const projectedEnemies = enemies.map((e) => ({
        ...e,
        position: projectNextPosition(e, e, windDirection),
      }))

      const futureUnit: Unit = {
        ...unit,
        position: projectedPos,
        orientation: newState.orientation,
        attitude: newState.attitude,
        isInIrons: newState.isInIrons,
      }
      const futureScore = evaluatePosition(futureUnit, projectedEnemies, terrain)
      score += futureScore * LOOKAHEAD_DISCOUNT
    }

    return score
  })

  // Hard guarantee: only ever pick a collision-free plan. Fall back to the full
  // set only if every plan collides (e.g. the ship is already boxed in) so it
  // doesn't freeze entirely.
  const clearIdx = plans.map((_, i) => i).filter((i) => !planCollides[i])
  const pool = clearIdx.length > 0 ? clearIdx : plans.map((_, i) => i)
  return selectPlan(
    pool.map((i) => plans[i]),
    pool.map((i) => planScores[i]),
    difficulty,
  )
}
