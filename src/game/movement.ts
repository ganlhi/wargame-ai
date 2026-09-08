import type { Attitude, Unit, MovementPlan, MoveChunk, SpeedRange } from '../types'
import { computeAttitude, windTowardPoint } from '../utils/attitude'

export const MOVEMENT_STEP = 5

export function getSpeedRangeForAttitude(
  attitude: Attitude,
  speedProfile: Record<Attitude, SpeedRange>,
): SpeedRange {
  return speedProfile[attitude]
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
  path: { x: number; y: number }[]
  poses: { x: number; y: number; orientation: number }[]
} {
  let { x, y } = unit.position
  let orientation = unit.orientation
  // A tack is under way from the moment it is declared, so the ship already
  // carries no way on during the turn it first swings up into the wind — even
  // though it begins that turn still beating.
  let isInIrons = unit.isInIrons || !!plan.isTack
  let tackDirection =
    unit.tackDirection ?? (plan.isTack ? tackTurnDirection(unit.orientation, windAngle) : null)
  let distanceTraveled = 0
  const path = [{ x, y }]
  const poses = [{ x, y, orientation }]

  for (const chunk of plan.chunks) {
    if (isInIrons) {
      const drift = driftVector(windAngle)
      // driftSpeed is the total drift for a whole turn, split across the 5 chunks.
      const driftPerChunk = (unit.driftSpeed ?? 10) / 5
      x += drift.dx * driftPerChunk
      y += drift.dy * driftPerChunk
    } else {
      const vec = orientationToVector(orientation)
      const nextX = x + vec.dx * chunk.distance
      const nextY = y + vec.dy * chunk.distance
      distanceTraveled += Math.hypot(nextX - x, nextY - y)
      x = nextX
      y = nextY
    }

    path.push({ x, y })
    // Heading used while travelling this segment (the turn, if any, applies
    // only after arriving here), so the pose reflects where the base actually
    // sat during the move.
    poses.push({ x, y, orientation })

    // The plan carries the turns in every case, tack included — a ship in irons
    // no longer swings by some separately-derived amount of its own.
    if (chunk.turn) {
      const dir = chunk.turn.direction === 'port' ? -1 : 1
      orientation = (orientation + dir * chunk.turn.points + 32) % 32
    }
  }

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
    path: path.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    poses,
  }
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
  const { maxTurnPoints, speedProfile } = unit

  // Mid-tack there is nothing to decide: the ship must keep swinging the same
  // way, under no sail, until it comes onto the new tack.
  if (unit.isInIrons) {
    return [buildTackPlan(unit, windAngle)]
  }

  const range = getSpeedRangeForAttitude(computeAttitude(windAngle, unit.orientation, unit.foreAndAftRigged), speedProfile)

  const effectiveMinDist = minMoveDistance(unit.prevMoveDistance, range.max)
  const startDist = Math.ceil(effectiveMinDist / MOVEMENT_STEP) * MOVEMENT_STEP
  const endDist = range.max

  for (let dist = startDist; dist <= endDist; dist += MOVEMENT_STEP) {
    const chunkDistances = splitMovement(dist)

    if (maxTurnPoints === 0) {
      plans.push(buildPlan(chunkDistances, [], 0, range.max))
      continue
    }

    for (let totalTP = 1; totalTP <= maxTurnPoints; totalTP++) {
      const effMax = computeEffectiveMaxSpeed(range.max, totalTP)
      if (dist > effMax) continue

      const dirs: ('port' | 'starboard')[] = ['port', 'starboard']

      const boundaries = [0, 1, 2, 3, 4]

      for (const b of boundaries) {
        for (const d of dirs) {
          plans.push(buildPlan(chunkDistances, [{ afterChunk: b, direction: d, points: totalTP }], totalTP, range.max))
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
                    range.max,
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
        plans.push(buildPlan([0, 0, 0, 0, 0], [{ afterChunk: 0, direction: dir, points: tp }], tp, range.max))
      }
    }

    plans.push(buildPlan([0, 0, 0, 0, 0], [], 0, range.max))
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
