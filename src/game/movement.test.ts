import { describe, it, expect } from 'vitest'
import {
  getInIronsTurnDirection,
  splitMovement,
  computeEffectiveMaxSpeed,
  orientationToVector,
  applyMovementPlan,
  enumerateMovementPlans,
  minMoveDistance,
} from './movement'
import type { Unit, MovementPlan, MoveChunk, Attitude, SpeedRange } from '../types'
import { computeAttitude } from '../utils/attitude'

const SPEED_PROFILE: Record<Attitude, SpeedRange> = {
  in_irons: { max: 0 },
  beating: { max: 60 },
  reaching: { max: 80 },
  quarter_reaching: { max: 100 },
  running: { max: 90 },
}

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'u1',
    name: 'Test',
    side: 'ai',
    position: { x: 100, y: 100 },
    orientation: 8,
    status: 'active',
    aiStyle: 'aggressive',
    maxTurnPoints: 6,
    foreAndAftRigged: false,
    speedProfile: SPEED_PROFILE,
    driftSpeed: 10,
    baseWidth: 30,
    baseLength: 80,
    firingArcs: [],
    attitude: 'reaching',
    isInIrons: false,
    grappledWith: null,
    prevAttitude: 'reaching',
    prevMoveDistance: 0,
    hiddenAIOrder: null,
    playerOrder: null,
    lastFireChunk: null,
    hiddenAIFirePlan: null,
    hiddenAIAction: null,
    ...overrides,
  }
}

function plan(chunks: MoveChunk[], totalTurnPoints = 0): MovementPlan {
  return {
    chunks: chunks as MovementPlan['chunks'],
    totalTurnPoints,
    effectiveMaxSpeed: 0,
  }
}

const straight = (d: number): MoveChunk[] => [
  { distance: d }, { distance: d }, { distance: d }, { distance: d }, { distance: d },
]

describe('splitMovement', () => {
  it('splits evenly with larger chunks first', () => {
    expect(splitMovement(167)).toEqual([34, 34, 33, 33, 33])
    expect(splitMovement(100)).toEqual([20, 20, 20, 20, 20])
    expect(splitMovement(3)).toEqual([1, 1, 1, 0, 0])
    expect(splitMovement(0)).toEqual([0, 0, 0, 0, 0])
  })

  it('always returns 5 chunks summing to the distance', () => {
    for (const d of [1, 7, 49, 123, 500]) {
      const chunks = splitMovement(d)
      expect(chunks).toHaveLength(5)
      expect(chunks.reduce((a, b) => a + b, 0)).toBe(d)
    }
  })
})

describe('computeEffectiveMaxSpeed', () => {
  it('reduces speed by 5% per turn point', () => {
    expect(computeEffectiveMaxSpeed(100, 0)).toBe(100)
    expect(computeEffectiveMaxSpeed(100, 5)).toBe(75)
    expect(computeEffectiveMaxSpeed(100, 6)).toBeCloseTo(70)
  })

  it('never goes negative', () => {
    expect(computeEffectiveMaxSpeed(100, 20)).toBe(0)
    expect(computeEffectiveMaxSpeed(100, 25)).toBe(0)
  })
})

describe('orientationToVector', () => {
  it('points north at 0 and rotates clockwise through the compass', () => {
    const approx = (v: { dx: number; dy: number }) => ({
      dx: Math.round(v.dx),
      dy: Math.round(v.dy),
    })
    expect(approx(orientationToVector(0))).toEqual({ dx: 0, dy: -1 }) // north / up
    expect(approx(orientationToVector(8))).toEqual({ dx: 1, dy: 0 }) // east
    expect(approx(orientationToVector(16))).toEqual({ dx: 0, dy: 1 }) // south
    expect(approx(orientationToVector(24))).toEqual({ dx: -1, dy: 0 }) // west
  })
})

describe('applyMovementPlan', () => {
  it('moves straight along the heading and reports distance travelled', () => {
    const unit = makeUnit({ position: { x: 100, y: 100 }, orientation: 8 })
    const result = applyMovementPlan(unit, plan(straight(10)), 0)
    expect(result.position).toEqual({ x: 150, y: 100 })
    expect(result.orientation).toBe(8)
    expect(result.distanceTraveled).toBe(50)
  })

  it('runs off the old table bounds unhindered — the table is infinite', () => {
    const unit = makeUnit({ position: { x: 980, y: 100 }, orientation: 8 })
    const result = applyMovementPlan(unit, plan(straight(10)), 0)
    expect(result.position).toEqual({ x: 1030, y: 100 })
    expect(result.distanceTraveled).toBe(50)
  })

  it('allows negative coordinates west and north of the origin', () => {
    const unit = makeUnit({ position: { x: 0, y: 0 }, orientation: 24 })
    const result = applyMovementPlan(unit, plan(straight(10)), 8)
    expect(result.position).toEqual({ x: -50, y: 0 })
    expect(result.distanceTraveled).toBe(50)
  })

  it('applies a turn at the end of a chunk and continues on the new heading', () => {
    const unit = makeUnit({ position: { x: 100, y: 100 }, orientation: 0 })
    const chunks: MoveChunk[] = [
      { distance: 10, turn: { direction: 'starboard', points: 8 } },
      { distance: 10 }, { distance: 10 }, { distance: 10 }, { distance: 10 },
    ]
    // wind=16 keeps both headings clear of "in irons".
    const result = applyMovementPlan(unit, plan(chunks, 8), 16)
    expect(result.orientation).toBe(8)
    expect(result.position).toEqual({ x: 140, y: 90 })
    expect(result.distanceTraveled).toBe(50)
  })

  it('drifts driftSpeed total per turn (split over 5 chunks) while in irons, with no forward distance', () => {
    const unit = makeUnit({
      position: { x: 500, y: 500 },
      orientation: 0,
      isInIrons: true,
      driftSpeed: 50,
      maxTurnPoints: 0, // no rotation, so it stays in irons all 5 chunks
    })
    const result = applyMovementPlan(unit, plan(straight(0)), 0)
    // Wind from the north (point 0) blows toward the south, so the ship drifts
    // straight downwind: +y, by the full 50mm over the turn.
    expect(result.position).toEqual({ x: 500, y: 550 })
    expect(result.isInIrons).toBe(true)
    expect(result.distanceTraveled).toBe(0)
  })

  it('always drifts straight downwind, whatever the wind', () => {
    // Regression: drift used to be computed 8 points (90°) off the wind rather
    // than 16, so a ship in irons crabbed sideways instead of falling downwind.
    const cases: [number, { x: number; y: number }][] = [
      [0, { x: 0, y: 50 }],   // from N  → drifts S
      [8, { x: -50, y: 0 }],  // from E  → drifts W
      [16, { x: 0, y: -50 }], // from S  → drifts N
      [24, { x: 50, y: 0 }],  // from W  → drifts E
    ]
    for (const [windDirection, expected] of cases) {
      const unit = makeUnit({
        position: { x: 0, y: 0 },
        orientation: windDirection, // bow into the wind, so it stays in irons
        isInIrons: true,
        driftSpeed: 50,
        maxTurnPoints: 0,
      })
      const result = applyMovementPlan(unit, plan(straight(0)), windDirection)
      expect(result.position).toEqual(expected)
    }
  })
})

describe('enumerateMovementPlans', () => {
  it('produces only plans with 5 chunks and turn points within the limit', () => {
    const unit = makeUnit({ orientation: 8, maxTurnPoints: 4 })
    const plans = enumerateMovementPlans(unit, 0, null)
    expect(plans.length).toBeGreaterThan(0)
    for (const p of plans) {
      expect(p.chunks).toHaveLength(5)
      expect(p.totalTurnPoints).toBeLessThanOrEqual(4)
      const perChunkTurns = p.chunks.reduce((s, c) => s + (c.turn?.points ?? 0), 0)
      expect(perChunkTurns).toBeLessThanOrEqual(4)
    }
  })

  it('returns a single drift-and-turn plan when the ship is in irons', () => {
    const unit = makeUnit({ orientation: 0, isInIrons: true, maxTurnPoints: 6 })
    const plans = enumerateMovementPlans(unit, 0, null)
    expect(plans).toHaveLength(1)
    expect(plans[0].chunks.every((c) => c.distance === 0)).toBe(true)
  })
})

describe('minMoveDistance', () => {
  it('is half of the distance actually covered last turn', () => {
    expect(minMoveDistance(80, 120)).toBe(40)
    expect(minMoveDistance(0, 120)).toBe(0)
  })

  it('falls back to half the maximum for a ship that has never moved', () => {
    expect(minMoveDistance(null, 120)).toBe(60)
  })
})

describe('enumerateMovementPlans — minimum move', () => {
  const totalOf = (p: { chunks: { distance: number }[] }) =>
    p.chunks.reduce((sum, c) => sum + c.distance, 0)

  it('never offers a plan shorter than half of last turn', () => {
    // reaching at wind 0 / orientation 8 → max 100 in this fixture.
    const unit = makeUnit({ orientation: 8, maxTurnPoints: 4, prevMoveDistance: 60 })
    const plans = enumerateMovementPlans(unit, 0, null)
    const moving = plans.filter((p) => totalOf(p) > 0)
    expect(moving.length).toBeGreaterThan(0)
    for (const p of moving) {
      expect(totalOf(p)).toBeGreaterThanOrEqual(30)
    }
  })

  it('holds a never-moved ship to at least half its maximum', () => {
    const unit = makeUnit({ orientation: 8, maxTurnPoints: 4, prevMoveDistance: null })
    const max = unit.speedProfile[computeAttitude(0, 8, unit.foreAndAftRigged)].max
    const plans = enumerateMovementPlans(unit, 0, null)
    const moving = plans.filter((p) => totalOf(p) > 0)
    expect(moving.length).toBeGreaterThan(0)
    for (const p of moving) {
      expect(totalOf(p)).toBeGreaterThanOrEqual(max / 2)
    }
    // ...and it is no longer free to simply sit still.
    expect(plans.filter((p) => totalOf(p) === 0 && p.totalTurnPoints === 0)).toHaveLength(0)
  })
})

describe('getInIronsTurnDirection', () => {
  // The turn direction branches on whether the ship is beating, so its band
  // boundary has to track computeAttitude's — otherwise a square-rigged ship at
  // 5 points off the wind would be "in irons" to one and "beating" to the other.
  it('treats a heading as beating exactly when computeAttitude does', () => {
    for (const rig of [false, true]) {
      for (let wind = 0; wind < 32; wind += 3) {
        for (let orientation = 0; orientation < 32; orientation++) {
          const attitude = computeAttitude(wind, orientation, rig)
          if (attitude !== 'in_irons' && attitude !== 'beating') continue
          const dir = getInIronsTurnDirection(orientation, wind, rig)
          expect(dir === 'port' || dir === 'starboard').toBe(true)
        }
      }
    }
  })

  it('swings a square rig the other way than a fore-and-aft rig at 5 points off', () => {
    // Wind from N (0); orientation 5 is 5 points off, the one heading where the
    // two rigs disagree, so they take opposite branches.
    expect(computeAttitude(0, 5, false)).toBe('in_irons')
    expect(computeAttitude(0, 5, true)).toBe('beating')
    expect(getInIronsTurnDirection(5, 0, false)).not.toBe(getInIronsTurnDirection(5, 0, true))
  })
})
