import { describe, it, expect } from 'vitest'
import {
  buildTackPlan,
  canTack,
  windSide,
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
    tackDirection: null,
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

describe('tacking procedure', () => {
  // Wind from the north (0). Orientation 6 (ENE) is 6 points off it, with the
  // wind on the port bow — beating for a square rig, and the shallowest angle
  // one can hold. Coming about therefore swings to port, through 12 points.
  const beating = (o: Partial<Unit> = {}) =>
    makeUnit({
      orientation: 6,
      attitude: 'beating',
      prevAttitude: 'beating',
      maxTurnPoints: 6,
      driftSpeed: 50,
      ...o,
    })

  describe('canTack', () => {
    it('allows it after a turn spent entirely beating', () => {
      expect(canTack(beating(), 'beating')).toBe(true)
    })

    it('refuses when the turn did not both start and end beating', () => {
      // Ended beating but started on a reach.
      expect(canTack(beating(), 'reaching')).toBe(false)
      // Started beating but ended on a reach.
      expect(canTack(beating({ attitude: 'reaching' }), 'beating')).toBe(false)
    })

    it('refuses a ship already in irons, or one that cannot move', () => {
      expect(canTack(beating({ isInIrons: true }), 'beating')).toBe(false)
      for (const status of ['immobilised', 'destroyed', 'surrendered', 'grappled'] as const) {
        expect(canTack(beating({ status }), 'beating')).toBe(false)
      }
    })
  })

  describe('buildTackPlan', () => {
    it('turns toward the wind, with no way on', () => {
      const plan = buildTackPlan(beating(), 0)
      expect(plan.isTack).toBe(true)
      expect(plan.chunks.every((c) => c.distance === 0)).toBe(true)
      // Wind on the port bow, so the bow swings to port through it.
      for (const chunk of plan.chunks) {
        if (chunk.turn) expect(chunk.turn.direction).toBe('port')
      }
    })

    it('splits the swing across at most two turns, as the movement rules require', () => {
      const plan = buildTackPlan(beating(), 0)
      expect(plan.chunks.filter((c) => c.turn).length).toBeLessThanOrEqual(2)
    })

    it('stops on the new tack rather than swinging past it into a reach', () => {
      // From 6 points to starboard, coming onto the new tack takes 12 points;
      // a ship with 20 available must not use them all and overshoot.
      const plan = buildTackPlan(beating({ maxTurnPoints: 20 }), 0)
      const result = applyMovementPlan(beating({ maxTurnPoints: 20 }), plan, 0)
      expect(result.attitude).toBe('beating')
      expect(result.tackDirection).toBeNull()
      expect(result.isInIrons).toBe(false)
    })

    it('keeps swinging the way the tack started, not the way the geometry suggests', () => {
      // Head to wind, mid-tack to starboard. The geometry alone cannot say which
      // way the ship arrived, so only the remembered direction gets this right.
      const unit = makeUnit({ orientation: 0, isInIrons: true, tackDirection: 'starboard', maxTurnPoints: 2 })
      const plan = buildTackPlan(unit, 0)
      for (const chunk of plan.chunks) {
        if (chunk.turn) expect(chunk.turn.direction).toBe('starboard')
      }
    })
  })

  describe('applyMovementPlan with a tack', () => {
    it('drifts downwind from the first chunk, though the ship starts beating', () => {
      const unit = beating({ position: { x: 0, y: 0 }, maxTurnPoints: 2 })
      const result = applyMovementPlan(unit, buildTackPlan(unit, 0), 0)
      // Wind from the north blows toward the south: the full 50mm of drift.
      expect(result.position).toEqual({ x: 0, y: 50 })
      expect(result.distanceTraveled).toBe(0)
    })

    it('leaves the ship in irons, still swinging the same way, when one turn is not enough', () => {
      const unit = beating({ maxTurnPoints: 2 })
      const result = applyMovementPlan(unit, buildTackPlan(unit, 0), 0)
      expect(result.attitude).toBe('in_irons')
      expect(result.isInIrons).toBe(true)
      expect(result.tackDirection).toBe('port')
    })

    it('comes about over several turns, drifting the whole way', () => {
      let unit = beating({ position: { x: 0, y: 0 }, maxTurnPoints: 2 })
      const attitudes: string[] = []
      let turns = 0
      while (turns < 10) {
        const result = applyMovementPlan(unit, buildTackPlan(unit, 0), 0)
        unit = {
          ...unit,
          position: result.position,
          orientation: result.orientation,
          attitude: result.attitude,
          isInIrons: result.isInIrons,
          tackDirection: result.tackDirection,
        }
        attitudes.push(result.attitude)
        turns++
        // Never any way on: the ship only ever drifts.
        expect(result.distanceTraveled).toBe(0)
        if (!result.isInIrons) break
      }
      // It finished, on the far tack, having gone through irons on the way.
      expect(unit.isInIrons).toBe(false)
      expect(unit.tackDirection).toBeNull()
      expect(unit.attitude).toBe('beating')
      expect(attitudes).toContain('in_irons')
      // Wind on the starboard bow now — the other side from where it started.
      expect(windSide(unit.orientation, 0)).toBe('starboard')
      // Pushed steadily downwind the whole time.
      expect(unit.position.y).toBe(50 * turns)
    })
  })

  describe('enumerateMovementPlans and tacking', () => {
    it('offers a tack to a ship that spent the last turn beating', () => {
      const plans = enumerateMovementPlans(beating(), 0, 'beating')
      expect(plans.filter((p) => p.isTack)).toHaveLength(1)
    })

    it('offers none to a ship that did not', () => {
      expect(enumerateMovementPlans(beating(), 0, 'reaching').some((p) => p.isTack)).toBe(false)
    })

    it('gives a ship mid-tack exactly one option: keep coming about', () => {
      const unit = makeUnit({ orientation: 2, isInIrons: true, tackDirection: 'port' })
      const plans = enumerateMovementPlans(unit, 0, 'beating')
      expect(plans).toHaveLength(1)
      expect(plans[0].isTack).toBe(true)
    })

    it('never offers an ordinary order that would leave the ship in irons', () => {
      const unit = beating()
      for (const plan of enumerateMovementPlans(unit, 0, 'beating')) {
        if (plan.isTack) continue
        expect(applyMovementPlan(unit, plan, 0).attitude).not.toBe('in_irons')
      }
    })
  })
})
