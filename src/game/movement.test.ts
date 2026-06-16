import { describe, it, expect } from 'vitest'
import {
  splitMovement,
  computeEffectiveMaxSpeed,
  orientationToVector,
  applyMovementPlan,
  enumerateMovementPlans,
} from './movement'
import type { Unit, MovementPlan, MoveChunk, Attitude, SpeedRange } from '../types'

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
    speedProfile: SPEED_PROFILE,
    driftSpeed: 10,
    firingArcs: [],
    attitude: 'reaching',
    isInIrons: false,
    prevAttitude: 'reaching',
    prevMoveDistance: 0,
    hiddenAIOrder: null,
    playerOrder: null,
    lastFireChunk: null,
    hiddenAIFirePlan: null,
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
    const result = applyMovementPlan(unit, plan(straight(10)), 0, 1000, 1000)
    expect(result.position).toEqual({ x: 150, y: 100 })
    expect(result.orientation).toBe(8)
    expect(result.distanceTraveled).toBe(50)
    expect(result.hitBoundary).toBe(false)
  })

  it('clamps to the table edge and only counts distance actually travelled', () => {
    const unit = makeUnit({ position: { x: 980, y: 100 }, orientation: 8 })
    const result = applyMovementPlan(unit, plan(straight(10)), 0, 1000, 1000)
    expect(result.position).toEqual({ x: 1000, y: 100 })
    expect(result.hitBoundary).toBe(true)
    // Only the first two chunks (980->990->1000) actually moved the ship.
    expect(result.distanceTraveled).toBe(20)
  })

  it('applies a turn at the end of a chunk and continues on the new heading', () => {
    const unit = makeUnit({ position: { x: 100, y: 100 }, orientation: 0 })
    const chunks: MoveChunk[] = [
      { distance: 10, turn: { direction: 'starboard', points: 8 } },
      { distance: 10 }, { distance: 10 }, { distance: 10 }, { distance: 10 },
    ]
    // wind=16 keeps both headings clear of "in irons".
    const result = applyMovementPlan(unit, plan(chunks, 8), 16, 1000, 1000)
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
    const result = applyMovementPlan(unit, plan(straight(0)), 0, 1000, 1000)
    // Drift direction at wind=0 is +x; 50 total drift over the turn.
    expect(result.position).toEqual({ x: 550, y: 500 })
    expect(result.isInIrons).toBe(true)
    expect(result.distanceTraveled).toBe(0)
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
