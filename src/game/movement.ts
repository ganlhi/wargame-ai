import type { Attitude, Unit, MovementPlan, MoveChunk } from '../types'
import { computeAttitude, windTowardPoint } from '../utils/attitude'
import { sternMidpoint } from '../utils/coordinates'

export const MOVEMENT_STEP = 5

/**
 * A ship's top speed on a point of sail, before any turn points are spent: the
 * figure from her speed profile scaled by her own multiplier. Everything that
 * needs a maximum goes through here, so the multiplier applies uniformly — to
 * the ceiling, to the half-of-maximum opening minimum, and to the AI's
 * projections of where a ship will be next turn.
 */
export function topSpeed(unit: Unit, attitude: Attitude = unit.attitude): number {
  return scaleSpeed(unit.speedProfile[attitude].max, unit.speedMultiplier)
}

/** Apply a ship's multiplier to one figure from her speed profile. */
export function scaleSpeed(max: number, speedMultiplier: number): number {
  return max * normaliseSpeedMultiplier(speedMultiplier)
}

/**
 * A speed multiplier as a decimal: any positive figure, since a ship under full
 * sail may well beat the profile she is usually worked at. Only negatives and
 * nonsense are ruled out — 1 when nothing usable is given.
 */
export function normaliseSpeedMultiplier(value: number | undefined | null): number {
  if (value === undefined || value === null || Number.isNaN(value)) return 1
  return Math.max(0, value)
}

/**
 * The multiplier is stored as a decimal but *entered* as a whole percentage —
 * 90% for a ship worked at nine tenths of her profile. A field that reparses
 * every keystroke cannot hold a half-typed decimal: "0." is not yet a number,
 * so it lands as 0 and the digits after the point never get in. A whole
 * percentage has no such intermediate state.
 */
export function speedMultiplierToPercent(multiplier: number | undefined | null): number {
  return Math.round(normaliseSpeedMultiplier(multiplier) * 100)
}

export function speedMultiplierFromPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 1
  return Math.max(0, percent) / 100
}

export function computeEffectiveMaxSpeed(baseMaxSpeed: number, turnPoints: number): number {
  return Math.max(0, baseMaxSpeed * (1 - turnPoints * 0.05))
}

/**
 * Shortest distance a ship is allowed to cover this turn: half of what it
 * actually covered last turn. A ship that has never had a movement phase
 * (`prevMoveDistance === null`) has no last turn to halve, so it starts from
 * half its maximum for the point of sail rather than being free to sit still.
 *
 * Measured against the *base* maximum, not the turn-point-reduced one, so the
 * floor is a fixed number for the turn: turning hard lowers the ceiling towards
 * it (and past 10 points of turn, below it — which is simply a plan the ship
 * cannot legally make).
 */
export function minMoveDistance(prevMoveDistance: number | null, baseMaxSpeed: number): number {
  return (prevMoveDistance ?? baseMaxSpeed) / 2
}

export function splitMovement(distance: number): [number, number, number, number, number] {
  const base = Math.floor(distance / 5)
  const remainder = distance % 5
  const chunks: number[] = []
  for (let i = 0; i < 5; i++) {
    chunks.push(base + (i < remainder ? 1 : 0))
  }
  return chunks as [number, number, number, number, number]
}

export function orientationToVector(orientation: number): { dx: number; dy: number } {
  const angle = (orientation * Math.PI / 16) - Math.PI / 2
  return { dx: Math.cos(angle), dy: Math.sin(angle) }
}

/** Where a ship's base sits: its centre (what `Unit.position` stores) and heading. */
export interface Pose {
  x: number
  y: number
  orientation: number
}

/**
 * The pose a ship ends up in after turning `points` to `direction`.
 *
 * A model is not spun about its middle: the rules pivot it on the **rear
 * corner of the base on the side it turns to** — the stern-port corner for a
 * turn to port, stern-starboard for one to starboard. That corner stays where
 * it is and the rest of the base swings round it, so a turn carries the
 * centre sideways and a little forward as well as changing the heading. With
 * no base entered the corner *is* the centre and the ship simply spins.
 */
export function pivotTurn(
  pose: Pose,
  direction: 'port' | 'starboard',
  points: number,
  baseWidth: number,
  baseLength: number,
): Pose {
  const side = direction === 'starboard' ? 1 : -1
  const angle = (pose.orientation * Math.PI) / 16 - Math.PI / 2
  // Forward (bow) unit vector and the perpendicular pointing to starboard.
  const fx = Math.cos(angle)
  const fy = Math.sin(angle)
  const rx = -fy
  const ry = fx
  const pivotX = pose.x - fx * (baseLength / 2) + side * rx * (baseWidth / 2)
  const pivotY = pose.y - fy * (baseLength / 2) + side * ry * (baseWidth / 2)

  // Swing the centre about that corner. Orientation runs clockwise on the
  // compass, which in this +y-South frame is a positive rotation.
  const theta = (side * points * Math.PI) / 16
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const dx = pose.x - pivotX
  const dy = pose.y - pivotY
  return {
    x: pivotX + dx * cos - dy * sin,
    y: pivotY + dx * sin + dy * cos,
    orientation: (pose.orientation + side * points + 32) % 32,
  }
}

/**
 * Unit vector a ship in irons drifts along: straight downwind, i.e. toward the
 * point the wind blows to. `windDirection` is the point it blows *from*, so
 * this is 16 points (180°) away — not 8, which would send the ship sideways
 * across the wind.
 */
export function driftVector(windDirection: number): { dx: number; dy: number } {
  return orientationToVector(windTowardPoint(windDirection))
}

/**
 * Which bow the wind is on. null when it is dead ahead or dead astern, where
 * there is no side to speak of.
 */
export function windSide(orientation: number, windDirection: number): 'port' | 'starboard' | null {
  const rel = ((windDirection - orientation) % 32 + 32) % 32
  if (rel === 0 || rel === 16) return null
  return rel < 16 ? 'starboard' : 'port'
}

/** The way a ship must swing to tack: toward whichever bow the wind is on. */
export function tackTurnDirection(orientation: number, windDirection: number): 'port' | 'starboard' {
  return windSide(orientation, windDirection) === 'port' ? 'port' : 'starboard'
}

/** The bow the wind ends up on once a tack in `direction` is complete. */
function tackTargetSide(direction: 'port' | 'starboard'): 'port' | 'starboard' {
  return direction === 'port' ? 'starboard' : 'port'
}

/**
 * Whether a ship may declare a tack. The procedure is only open to a ship that
 * spent the whole of the previous turn beating — beating as the turn started
 * and still beating as it ended.
 */
export function canTack(unit: Unit, prevAttitude: Attitude | null): boolean {
  return (
    unit.status === 'active' &&
    !unit.isInIrons &&
    // A ship that cannot turn at all can never come through the wind.
    unit.maxTurnPoints > 0 &&
    unit.attitude === 'beating' &&
    prevAttitude === 'beating'
  )
}

/** Whether a tack that swung `direction` has finished: beating on the new tack. */
export function isTackComplete(
  orientation: number,
  windDirection: number,
  direction: 'port' | 'starboard',
  foreAndAftRigged: boolean,
): boolean {
  return (
    computeAttitude(windDirection, orientation, foreAndAftRigged) === 'beating' &&
    windSide(orientation, windDirection) === tackTargetSide(direction)
  )
}

/**
 * How far the ship swings this turn: everything it has, but stopping the moment
 * it comes onto the new tack, since the procedure ends there and overshooting
 * would carry it past beating into a reach.
 */
export function tackPointsThisTurn(
  unit: Unit,
  windDirection: number,
  direction: 'port' | 'starboard',
): number {
  const step = direction === 'port' ? -1 : 1
  let orientation = unit.orientation
  for (let points = 1; points <= unit.maxTurnPoints; points++) {
    orientation = (orientation + step + 32) % 32
    if (isTackComplete(orientation, windDirection, direction, unit.foreAndAftRigged)) return points
  }
  return unit.maxTurnPoints
}

function buildPlan(
  distances: number[],
  turns: { afterChunk: number; direction: 'port' | 'starboard'; points: number }[],
  totalTurnPoints: number,
  baseMaxSpeed: number,
): MovementPlan {
  const chunks: MoveChunk[] = distances.map((d, i) => {
    const turn = turns.find((t) => t.afterChunk === i)
    return turn ? { distance: d, turn: { direction: turn.direction, points: turn.points } } : { distance: d }
  })
  return {
    chunks: chunks as [MoveChunk, MoveChunk, MoveChunk, MoveChunk, MoveChunk],
    totalTurnPoints,
    effectiveMaxSpeed: computeEffectiveMaxSpeed(baseMaxSpeed, totalTurnPoints),
  }
}

/**
 * Walk a movement plan chunk by chunk. The table is infinite, so nothing here
 * constrains where a ship can end up — positions are free to go negative or run
 * arbitrarily far from the origin.
 */
/**
 * The order for a tack: no way on at all, and every turn point available spent
 * swinging through the wind — split into at most two turns, as the movement
 * rules require. A ship already mid-tack keeps the direction it started with.
 */
export function buildTackPlan(unit: Unit, windDirection: number): MovementPlan {
  const direction = unit.tackDirection ?? tackTurnDirection(unit.orientation, windDirection)
  const points = tackPointsThisTurn(unit, windDirection, direction)
  const first = Math.ceil(points / 2)
  const second = points - first
  const turns: { afterChunk: number; direction: 'port' | 'starboard'; points: number }[] = []
  if (first > 0) turns.push({ afterChunk: 1, direction, points: first })
  if (second > 0) turns.push({ afterChunk: 3, direction, points: second })
  return { ...buildPlan([0, 0, 0, 0, 0], turns, points, 0), isTack: true }
}

export function applyMovementPlan(
  unit: Unit,
  plan: MovementPlan,
  windAngle: number,
): {
  position: { x: number; y: number }
  orientation: number
  attitude: Attitude
  isInIrons: boolean
  tackDirection: 'port' | 'starboard' | null
  distanceTraveled: number
  /**
   * The track the ship's reference point — the middle of her stern edge —
   * follows, for drawing. That is the point a player measures her by, so it is
   * the one whose track reads directly against the table. Where a chunk ends
   * in a turn it holds both the point the ship arrived at and where the pivot
   * left her, so the sideways jog of a corner pivot shows on the map.
   */
  path: { x: number; y: number }[]
  /**
   * Six entries: the pose as the turn opens, then the pose at the end of each
   * chunk *after* any turn taken there — what a player moving the model chunk
   * by chunk would see on the table at each step.
   */
  poses: Pose[]
  /**
   * Every pose the base occupies during the move, in order: the start, each
   * chunk's arrival point on the old heading, and each post-pivot pose. This
   * is what collision checks must sweep — the base sits on the arrival point
   * before it swings, and on the pivoted one after.
   */
  sweptPoses: Pose[]
} {
  let pose: Pose = { x: unit.position.x, y: unit.position.y, orientation: unit.orientation }
  // A tack is under way from the moment it is declared, so the ship already
  // carries no way on during the turn it first swings up into the wind — even
  // though it begins that turn still beating.
  let isInIrons = unit.isInIrons || !!plan.isTack
  let tackDirection =
    unit.tackDirection ?? (plan.isTack ? tackTurnDirection(unit.orientation, windAngle) : null)
  let distanceTraveled = 0
  const poses = [pose]
  const sweptPoses = [pose]

  for (const chunk of plan.chunks) {
    if (isInIrons) {
      const drift = driftVector(windAngle)
      // driftSpeed is the total drift for a whole turn, split across the 5 chunks.
      const driftPerChunk = (unit.driftSpeed ?? 10) / 5
      pose = { ...pose, x: pose.x + drift.dx * driftPerChunk, y: pose.y + drift.dy * driftPerChunk }
    } else {
      const vec = orientationToVector(pose.orientation)
      pose = { ...pose, x: pose.x + vec.dx * chunk.distance, y: pose.y + vec.dy * chunk.distance }
      // Only way made under sail counts toward next turn's minimum; the small
      // displacement of a pivot is not distance sailed.
      distanceTraveled += chunk.distance
    }

    // The plan carries the turns in every case, tack included — a ship in irons
    // no longer swings by some separately-derived amount of its own. The turn
    // pivots the model on its rear corner, so it moves the centre as well as
    // the heading; the base sits on the arrival point before it swings.
    if (chunk.turn) {
      sweptPoses.push(pose)
      pose = pivotTurn(pose, chunk.turn.direction, chunk.turn.points, unit.baseWidth, unit.baseLength)
    }

    poses.push(pose)
    sweptPoses.push(pose)
  }

  const { x, y, orientation } = pose
  const attitude = computeAttitude(windAngle, orientation, unit.foreAndAftRigged)

  if (tackDirection) {
    // The tack runs until the ship is beating on the far side of the wind. It
    // resolves only at the end of a turn: a ship that comes round part-way
    // through still spends the rest of that turn drifting, and gathers way
    // again next turn.
    if (isTackComplete(orientation, windAngle, tackDirection, unit.foreAndAftRigged)) {
      isInIrons = false
      tackDirection = null
    }
  } else if (attitude === 'in_irons') {
    // A ship that ends up in irons without declaring a tack — dragged round, or
    // an order built before the rule applied — is put into the procedure, so it
    // always has a defined way out rather than sitting head to wind for ever.
    isInIrons = true
    tackDirection = tackTurnDirection(orientation, windAngle)
  }

  return {
    position: { x: Math.round(x), y: Math.round(y) },
    orientation: Math.round(orientation) % 32,
    attitude,
    isInIrons,
    tackDirection,
    distanceTraveled: Math.round(distanceTraveled),
    // The swept poses are exactly the stations the track passes through — the
    // start, each arrival point on the old heading, and each post-pivot pose —
    // and each carries the heading the stern point must be taken against.
    path: sweptPoses.map((p) => {
      const stern = sternMidpoint(p, p.orientation, unit.baseLength)
      return { x: Math.round(stern.x), y: Math.round(stern.y) }
    }),
    poses,
    sweptPoses,
  }
}

/**
 * The order a ship will actually carry out this turn: the one entered for her,
 * or, mid-tack with nothing entered, the continuation the rules force on her.
 * A destroyed or surrendered ship is a wreck on the table and goes nowhere,
 * whatever order she may still be carrying.
 */
export function turnOrderFor(unit: Unit, windDirection: number): MovementPlan | null {
  if (unit.status === 'destroyed' || unit.status === 'surrendered') return null
  return (
    (unit.side === 'ai' ? unit.hiddenAIOrder : unit.playerOrder) ??
    (unit.isInIrons ? buildTackPlan(unit, windDirection) : null)
  )
}

/**
 * The pose a ship is in as the turn opens and at the end of each of the five
 * chunks, following her order for the turn. A ship with no order holds her
 * pose throughout.
 */
export function turnPosesFor(unit: Unit, windDirection: number): Pose[] {
  const plan = turnOrderFor(unit, windDirection)
  if (!plan) {
    const still: Pose = { x: unit.position.x, y: unit.position.y, orientation: unit.orientation }
    return Array.from({ length: 6 }, () => still)
  }
  return applyMovementPlan(unit, plan, windDirection).poses
}

/**
 * Every unit as it will stand at the end of `chunk` (0 = as the turn opens,
 * 5 = the end of the turn), for previewing the orders on the map.
 */
export function unitsAtChunk(units: Unit[], windDirection: number, chunk: number): Unit[] {
  return units.map((u) => {
    const pose = turnPosesFor(u, windDirection)[Math.max(0, Math.min(5, chunk))]
    return { ...u, position: { x: pose.x, y: pose.y }, orientation: pose.orientation }
  })
}

/**
 * Where a tack declared now would leave the ship, and how many turns it takes.
 *
 * A tack is judged by its outcome, not by the turn it begins: on that turn the
 * ship is in irons, making no way and drifting to leeward, which is as bad as a
 * position gets. Running the whole procedure forward gives the pose that is
 * actually being bought — beating on the far tack, some way downwind of here.
 *
 * `maxTurns` only guards against a ship that somehow cannot come round; a tack
 * takes `ceil(points to swing / maxTurnPoints)` turns, which is small.
 */
export function projectTackCompletion(
  unit: Unit,
  windDirection: number,
  maxTurns = 8,
): { position: { x: number; y: number }; orientation: number; turns: number; completed: boolean } {
  let current = unit
  let turns = 0
  let completed = false

  while (turns < maxTurns) {
    const plan = buildTackPlan(current, windDirection)
    if (plan.totalTurnPoints === 0) break
    const result = applyMovementPlan(current, plan, windDirection)
    current = {
      ...current,
      position: result.position,
      orientation: result.orientation,
      attitude: result.attitude,
      isInIrons: result.isInIrons,
      tackDirection: result.tackDirection,
    }
    turns++
    if (!result.isInIrons) {
      completed = true
      break
    }
  }

  return { position: current.position, orientation: current.orientation, turns, completed }
}

export function enumerateMovementPlans(
  unit: Unit,
  windAngle: number,
  prevAttitude: Attitude | null,
): MovementPlan[] {
  const plans: MovementPlan[] = []
  const { maxTurnPoints } = unit

  // Mid-tack there is nothing to decide: the ship must keep swinging the same
  // way, under no sail, until it comes onto the new tack.
  if (unit.isInIrons) {
    return [buildTackPlan(unit, windAngle)]
  }

  const maxSpeed = topSpeed(
    unit,
    computeAttitude(windAngle, unit.orientation, unit.foreAndAftRigged),
  )

  const effectiveMinDist = minMoveDistance(unit.prevMoveDistance, maxSpeed)
  const startDist = Math.ceil(effectiveMinDist / MOVEMENT_STEP) * MOVEMENT_STEP
  const endDist = maxSpeed

  for (let dist = startDist; dist <= endDist; dist += MOVEMENT_STEP) {
    const chunkDistances = splitMovement(dist)

    if (maxTurnPoints === 0) {
      plans.push(buildPlan(chunkDistances, [], 0, maxSpeed))
      continue
    }

    for (let totalTP = 1; totalTP <= maxTurnPoints; totalTP++) {
      const effMax = computeEffectiveMaxSpeed(maxSpeed, totalTP)
      if (dist > effMax) continue

      const dirs: ('port' | 'starboard')[] = ['port', 'starboard']

      const boundaries = [0, 1, 2, 3, 4]

      for (const b of boundaries) {
        for (const d of dirs) {
          plans.push(buildPlan(chunkDistances, [{ afterChunk: b, direction: d, points: totalTP }], totalTP, maxSpeed))
        }
      }

      if (totalTP >= 2) {
        for (let tp1 = 1; tp1 < totalTP; tp1++) {
          const tp2 = totalTP - tp1
          for (let bi = 0; bi < boundaries.length; bi++) {
            for (let bj = bi + 1; bj < boundaries.length; bj++) {
              for (const d1 of dirs) {
                for (const d2 of dirs) {
                  plans.push(buildPlan(
                    chunkDistances,
                    [
                      { afterChunk: boundaries[bi], direction: d1, points: tp1 },
                      { afterChunk: boundaries[bj], direction: d2, points: tp2 },
                    ],
                    totalTP,
                    maxSpeed,
                  ))
                }
              }
            }
          }
        }
      }
    }
  }

  if (effectiveMinDist <= 0) {
    for (let tp = 1; tp <= maxTurnPoints; tp++) {
      for (const dir of (['port', 'starboard'] as const)) {
        plans.push(buildPlan([0, 0, 0, 0, 0], [{ afterChunk: 0, direction: dir, points: tp }], tp, maxSpeed))
      }
    }

    plans.push(buildPlan([0, 0, 0, 0, 0], [], 0, maxSpeed))
  }

  // Turning up into the wind is only legal through the tacking procedure, so
  // discard any ordinary order that would leave the ship in irons.
  const legal = plans.filter(
    (plan) =>
      computeAttitude(windAngle, applyMovementPlan(unit, plan, windAngle).orientation, unit.foreAndAftRigged) !==
      'in_irons',
  )

  if (canTack(unit, prevAttitude)) {
    legal.push(buildTackPlan(unit, windAngle))
  }

  return legal
}
