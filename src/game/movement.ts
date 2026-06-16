import type { Attitude, Unit, MovementPlan, MoveChunk, SpeedRange } from '../types'
import { computeAttitude } from '../utils/attitude'

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

function getInIronsTurnDirection(orientation: number, windDirection: number): 'port' | 'starboard' {
  const rel = ((windDirection - orientation) % 32 + 32) % 32
  const norm = rel > 16 ? 32 - rel : rel

  if (norm >= 5 && norm <= 7) {
    if (rel <= 16) return 'starboard'
    return 'port'
  }

  if (rel <= 4) return 'port'
  return 'starboard'
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

export function applyMovementPlan(
  unit: Unit,
  plan: MovementPlan,
  windAngle: number,
  tableWidth: number,
  tableHeight: number,
): {
  position: { x: number; y: number }
  orientation: number
  attitude: Attitude
  isInIrons: boolean
  hitBoundary: boolean
  path: { x: number; y: number }[]
} {
  let { x, y } = unit.position
  let orientation = unit.orientation
  let isInIrons = unit.isInIrons
  const path = [{ x, y }]

  for (const chunk of plan.chunks) {
    if (isInIrons) {
      const driftDir = (windAngle + 8) % 32
      const driftAngle = (driftDir * Math.PI / 16) - Math.PI / 2
      x += Math.cos(driftAngle) * (unit.driftSpeed ?? 10)
      y += Math.sin(driftAngle) * (unit.driftSpeed ?? 10)
    } else {
      const vec = orientationToVector(orientation)
      x += vec.dx * chunk.distance
      y += vec.dy * chunk.distance
    }

    path.push({ x, y })

    if (isInIrons) {
      const dir = getInIronsTurnDirection(orientation, windAngle)
      const pts = Math.ceil(unit.maxTurnPoints / 2)
      orientation = dir === 'port'
        ? (orientation - pts + 32) % 32
        : (orientation + pts) % 32

      const newAtt = computeAttitude(windAngle, orientation)
      if (newAtt === 'beating') {
        isInIrons = false
      }
    } else if (chunk.turn) {
      const dir = chunk.turn.direction === 'port' ? -1 : 1
      orientation = (orientation + dir * chunk.turn.points + 32) % 32
    }
  }

  const clampedX = Math.max(0, Math.min(tableWidth, x))
  const clampedY = Math.max(0, Math.min(tableHeight, y))
  const hitBoundary = clampedX !== x || clampedY !== y

  const attitude = computeAttitude(windAngle, orientation)

  if (!isInIrons && attitude === 'in_irons' && !unit.isInIrons) {
    isInIrons = true
  }

  return {
    position: { x: Math.round(clampedX), y: Math.round(clampedY) },
    orientation: Math.round(orientation) % 32,
    attitude,
    isInIrons,
    hitBoundary,
    path: path.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
  }
}

export function enumerateMovementPlans(
  unit: Unit,
  windAngle: number,
  prevAttitude: Attitude | null,
): MovementPlan[] {
  const plans: MovementPlan[] = []
  const { maxTurnPoints, speedProfile } = unit

  if (unit.isInIrons) {
    const dir = getInIronsTurnDirection(unit.orientation, windAngle)
    const turn1 = Math.ceil(maxTurnPoints / 2)
    const turn2 = maxTurnPoints - turn1
    const turns: { afterChunk: number; direction: 'port' | 'starboard'; points: number }[] = []
    if (turn1 > 0) turns.push({ afterChunk: 1, direction: dir, points: turn1 })
    if (turn2 > 0) turns.push({ afterChunk: 3, direction: dir, points: turn2 })
    plans.push(buildPlan([0, 0, 0, 0, 0], turns, maxTurnPoints, speedProfile[computeAttitude(windAngle, unit.orientation)].max))
    return plans
  }

  const range = getSpeedRangeForAttitude(computeAttitude(windAngle, unit.orientation), speedProfile)

  const startDist = Math.ceil(range.min / MOVEMENT_STEP) * MOVEMENT_STEP
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

  if (!unit.isInIrons) {
    const dir = getInIronsTurnDirection(unit.orientation, windAngle)
    const turn1 = Math.ceil(maxTurnPoints / 2)
    const turn2 = maxTurnPoints - turn1
    const turns: { afterChunk: number; direction: 'port' | 'starboard'; points: number }[] = []
    if (turn1 > 0) turns.push({ afterChunk: 1, direction: dir, points: turn1 })
    if (turn2 > 0) turns.push({ afterChunk: 3, direction: dir, points: turn2 })
    plans.push(buildPlan([0, 0, 0, 0, 0], turns, maxTurnPoints, range.max))
  }

  if (prevAttitude === 'beating' && !unit.isInIrons) {
    const dir = getInIronsTurnDirection(unit.orientation, windAngle)
    const oppDir = dir === 'port' ? 'starboard' : 'port'
    const turn1 = Math.ceil(maxTurnPoints / 2)
    const turn2 = maxTurnPoints - turn1
    const turns: { afterChunk: number; direction: 'port' | 'starboard'; points: number }[] = []
    if (turn1 > 0) turns.push({ afterChunk: 1, direction: oppDir, points: turn1 })
    if (turn2 > 0) turns.push({ afterChunk: 3, direction: oppDir, points: turn2 })
    plans.push(buildPlan([0, 0, 0, 0, 0], turns, maxTurnPoints, range.max))
  }

  for (let tp = 1; tp <= maxTurnPoints; tp++) {
    for (const dir of (['port', 'starboard'] as const)) {
      plans.push(buildPlan([0, 0, 0, 0, 0], [{ afterChunk: 0, direction: dir, points: tp }], tp, range.max))
    }
  }

  plans.push(buildPlan([0, 0, 0, 0, 0], [], 0, range.max))

  return plans
}
