import { describe, it, expect } from 'vitest'
import {
  buildTackPlan,
  canTack,
  projectTackCompletion,
  windSide,
  splitMovement,
  computeEffectiveMaxSpeed,
  orientationToVector,
  pivotTurn,
  applyMovementPlan,
  enumerateMovementPlans,
  minMoveDistance,
  planSailedDistance,
  topSpeed,
  normaliseSpeedMultiplier,
  speedMultiplierFromPercent,
  speedMultiplierToPercent,
  turnOrderFor,
  turnPosesFor,
  unitsAtChunk,
} from './movement'
import type { Pose } from './movement'
import type { Unit, MovementPlan, MoveChunk, Attitude, SpeedRange } from '../types'
import { computeAttitude } from '../utils/attitude'
import { baseCorners } from '../utils/geometry'

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
    speedMultiplier: 1,
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
    lastFireChunks: {},
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

describe('planSailedDistance', () => {
  it('adds the chunks up, matching what applyMovementPlan reports as sailed', () => {
    const p = plan([{ distance: 17 }, { distance: 17, turn: { direction: 'port', points: 2 } }, { distance: 17 }, { distance: 16 }, { distance: 16 }], 2)
    expect(planSailedDistance(p)).toBe(83)
    expect(applyMovementPlan(makeUnit(), p, 0).distanceTraveled).toBe(83)
  })

  it('is 0 for a ship making no way of her own — a declared tack, or one already in irons', () => {
    expect(planSailedDistance({ ...plan(straight(10)), isTack: true })).toBe(0)
    expect(planSailedDistance(plan(straight(10)), true)).toBe(0)
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

describe('pivotTurn', () => {
  const approx = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) })
  // baseCorners lists bow-starboard, bow-port, stern-port, stern-starboard.
  const rearCorner = (pose: Pose, side: 'port' | 'starboard', w: number, l: number) =>
    baseCorners(pose, pose.orientation, w, l)[side === 'port' ? 2 : 3]

  it('pivots on the rear corner of the base on the side of the turn', () => {
    // A model is turned about its stern-port corner to port and its
    // stern-starboard corner to starboard: that corner does not move at all.
    for (const side of ['port', 'starboard'] as const) {
      for (const orientation of [0, 3, 8, 13, 21, 30]) {
        for (const points of [1, 4, 8]) {
          const before: Pose = { x: 120, y: -45, orientation }
          const after = pivotTurn(before, side, points, 30, 80)
          expect(approx(rearCorner(after, side, 30, 80))).toEqual(approx(rearCorner(before, side, 30, 80)))
          expect(after.orientation).toBe((orientation + (side === 'port' ? -points : points) + 32) % 32)
        }
      }
    }
  })

  it('carries the centre sideways and forward as the base swings round', () => {
    // Heading north at the origin on a 30×80 base, 8 points to starboard: the
    // stern-starboard corner is at (15, 40); swinging the centre a quarter turn
    // clockwise about it lands the base heading east, centred at (55, 25).
    const after = pivotTurn({ x: 0, y: 0, orientation: 0 }, 'starboard', 8, 30, 80)
    expect(approx(after)).toEqual({ x: 55, y: 25 })
    expect(after.orientation).toBe(8)
  })

  it('spins in place when the ship has no base entered', () => {
    const after = pivotTurn({ x: 10, y: 20, orientation: 4 }, 'port', 3, 0, 0)
    expect(approx(after)).toEqual({ x: 10, y: 20 })
    expect(after.orientation).toBe(1)
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
    // 10mm north to (100, 90); the 30×80 base then pivots a quarter turn about
    // its stern-starboard corner at (115, 130), which carries the centre to
    // (155, 115); then 40mm east.
    expect(result.position).toEqual({ x: 195, y: 115 })
    // The pivot's displacement is not way made: only the 50mm sailed counts.
    expect(result.distanceTraveled).toBe(50)
  })

  it('reports the pose at the end of every chunk, and every pose the base sat on', () => {
    const unit = makeUnit({ position: { x: 100, y: 100 }, orientation: 0 })
    const chunks: MoveChunk[] = [
      { distance: 10, turn: { direction: 'starboard', points: 8 } },
      { distance: 10 }, { distance: 10 }, { distance: 10 }, { distance: 10 },
    ]
    const result = applyMovementPlan(unit, plan(chunks, 8), 16)

    // Six poses: the start, then the end of each chunk after its turn.
    expect(result.poses).toHaveLength(6)
    expect(result.poses[0]).toEqual({ x: 100, y: 100, orientation: 0 })
    expect(result.poses[1].orientation).toBe(8)
    expect({ x: Math.round(result.poses[1].x), y: Math.round(result.poses[1].y) }).toEqual({ x: 155, y: 115 })
    expect({ x: Math.round(result.poses[5].x), y: Math.round(result.poses[5].y) }).toEqual(result.position)

    // The swept set also holds the arrival point on the old heading, since the
    // base sits there before it swings — a collision check must see both.
    expect(result.sweptPoses).toHaveLength(7)
    expect(result.sweptPoses[1]).toEqual({ x: 100, y: 90, orientation: 0 })
    expect(result.sweptPoses[2]).toEqual(result.poses[1])

    // The drawn track follows the stern midpoint — the reference point a
    // player measures the model by — and jogs through the pivot rather than
    // cutting the corner. Bow north with an 80mm base puts the stern 40mm
    // south of the centre; once the bow is east it is 40mm west of it.
    expect(result.path).toHaveLength(7)
    expect(result.path[0]).toEqual({ x: 100, y: 140 })
    expect(result.path[1]).toEqual({ x: 100, y: 130 })
    expect(result.path[2]).toEqual({ x: 115, y: 115 })
    expect(result.path[6]).toEqual({ x: 155, y: 115 })
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
  //
  // No base is entered, so each swing pivots on the centre itself and only the
  // drift moves the ship: the drift figures below are then exact. The corner
  // pivot has its own tests.
  const beating = (o: Partial<Unit> = {}) =>
    makeUnit({
      orientation: 6,
      attitude: 'beating',
      prevAttitude: 'beating',
      maxTurnPoints: 6,
      driftSpeed: 50,
      baseWidth: 0,
      baseLength: 0,
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

    it('pivots on the rear corner while coming about, just like any other turn', () => {
      // The model is turned the same way whether or not she has way on, so a
      // tacking ship's stern-port corner (she swings to port) only moves by the
      // drift between one swing and the next.
      const unit = beating({ position: { x: 0, y: 0 }, maxTurnPoints: 2, driftSpeed: 0, baseWidth: 30, baseLength: 80 })
      const result = applyMovementPlan(unit, buildTackPlan(unit, 0), 0)
      const cornerBefore = baseCorners(unit.position, unit.orientation, 30, 80)[2]
      const cornerAfter = baseCorners(result.poses[5], result.orientation, 30, 80)[2]
      expect(Math.round(cornerAfter.x)).toBe(Math.round(cornerBefore.x))
      expect(Math.round(cornerAfter.y)).toBe(Math.round(cornerBefore.y))
      expect(result.position).not.toEqual({ x: 0, y: 0 })
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

  describe('projectTackCompletion', () => {
    it('runs the whole procedure out to the new tack', () => {
      const unit = beating({ position: { x: 0, y: 0 }, maxTurnPoints: 6, driftSpeed: 20 })
      const outcome = projectTackCompletion(unit, 0)
      expect(outcome.completed).toBe(true)
      // 12 points to swing at 6 a turn, drifting 20mm downwind each time.
      expect(outcome.turns).toBe(2)
      expect(outcome.orientation).toBe(26)
      expect(outcome.position).toEqual({ x: 0, y: 40 })
      expect(windSide(outcome.orientation, 0)).toBe('starboard')
    })

    it('reports failure rather than looping for a ship that cannot come round', () => {
      const outcome = projectTackCompletion(beating({ maxTurnPoints: 0 }), 0)
      expect(outcome.completed).toBe(false)
      expect(outcome.turns).toBe(0)
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

describe('previewing a turn chunk by chunk', () => {
  const order = (chunks: MoveChunk[]): MovementPlan => plan(chunks, 0)

  it('uses the order a ship will actually carry out', () => {
    const wind = 16
    const ai = makeUnit({ side: 'ai', hiddenAIOrder: order(straight(10)) })
    const player = makeUnit({ side: 'player', playerOrder: order(straight(10)) })
    expect(turnOrderFor(ai, wind)).toBe(ai.hiddenAIOrder)
    expect(turnOrderFor(player, wind)).toBe(player.playerOrder)
    // Mid-tack with nothing entered, the forced continuation stands in.
    const tacking = makeUnit({ orientation: 2, isInIrons: true, tackDirection: 'port' })
    expect(turnOrderFor(tacking, 0)?.isTack).toBe(true)
    // A wreck goes nowhere, whatever it still carries.
    const wreck = makeUnit({ side: 'player', status: 'destroyed', playerOrder: order(straight(10)) })
    expect(turnOrderFor(wreck, wind)).toBeNull()
  })

  it('holds a ship with no order where she is for the whole turn', () => {
    const unit = makeUnit({ position: { x: 40, y: 60 }, orientation: 8 })
    const poses = turnPosesFor(unit, 16)
    expect(poses).toHaveLength(6)
    for (const p of poses) expect(p).toEqual({ x: 40, y: 60, orientation: 8 })
  })

  it('places every ship at the end of the chosen chunk, finishing where the move resolves', () => {
    const mover = makeUnit({
      id: 'm', side: 'player', position: { x: 0, y: 0 }, orientation: 8,
      playerOrder: order([
        { distance: 10, turn: { direction: 'port', points: 2 } },
        { distance: 10 }, { distance: 10 }, { distance: 10 }, { distance: 10 },
      ]),
    })
    const still = makeUnit({ id: 's', position: { x: 300, y: 0 }, orientation: 16 })

    const atStart = unitsAtChunk([mover, still], 16, 0)
    expect(atStart[0].position).toEqual({ x: 0, y: 0 })
    expect(atStart[0].orientation).toBe(8)

    const afterFirst = unitsAtChunk([mover, still], 16, 1)
    expect(afterFirst[0].orientation).toBe(6)
    expect(afterFirst[1].position).toEqual({ x: 300, y: 0 })

    const atEnd = unitsAtChunk([mover, still], 16, 5)
    const resolved = applyMovementPlan(mover, mover.playerOrder!, 16)
    expect({ x: Math.round(atEnd[0].position.x), y: Math.round(atEnd[0].position.y) }).toEqual(resolved.position)
    expect(atEnd[0].orientation).toBe(resolved.orientation)
  })
})

describe('speed multiplier', () => {
  const attitude = computeAttitude(0, 8, false)
  const totalOf = (p: { chunks: { distance: number }[] }) =>
    p.chunks.reduce((sum, c) => sum + c.distance, 0)
  const furthest = (u: Unit) =>
    Math.max(...enumerateMovementPlans(u, 0, null).map(totalOf))

  it('scales the top speed on every point of sail', () => {
    const plain = makeUnit({ orientation: 8, speedMultiplier: 1 })
    expect(topSpeed(plain, attitude)).toBe(SPEED_PROFILE[attitude].max)
    expect(topSpeed({ ...plain, speedMultiplier: 0.5 }, attitude)).toBe(
      SPEED_PROFILE[attitude].max * 0.5,
    )
    // Above 1 too: a ship under full sail beats the profile she is usually
    // worked at, so the figure is a free decimal rather than a fraction.
    expect(topSpeed({ ...plain, speedMultiplier: 1.35 }, attitude)).toBeCloseTo(
      SPEED_PROFILE[attitude].max * 1.35,
    )
  })

  it('takes any positive decimal, and nothing else', () => {
    expect(normaliseSpeedMultiplier(0.85)).toBe(0.85)
    expect(normaliseSpeedMultiplier(2.5)).toBe(2.5)
    expect(normaliseSpeedMultiplier(-1)).toBe(0)
    expect(normaliseSpeedMultiplier(undefined)).toBe(1)
    expect(normaliseSpeedMultiplier(NaN)).toBe(1)
  })

  it('is entered as a whole percentage and stored as the decimal', () => {
    // 90% is the case a decimal field could not take: "0." reparses to 0 and
    // swallows the digits after the point.
    expect(speedMultiplierFromPercent(90)).toBe(0.9)
    expect(speedMultiplierFromPercent(100)).toBe(1)
    expect(speedMultiplierFromPercent(135)).toBe(1.35)
    expect(speedMultiplierFromPercent(0)).toBe(0)
    // An emptied field parses as NaN rather than a number.
    expect(speedMultiplierFromPercent(NaN)).toBe(1)
    expect(speedMultiplierFromPercent(-20)).toBe(0)
  })

  it('shows a stored multiplier back as the percentage that produced it', () => {
    for (const percent of [0, 55, 90, 100, 135, 250]) {
      expect(speedMultiplierToPercent(speedMultiplierFromPercent(percent))).toBe(percent)
    }
    expect(speedMultiplierToPercent(undefined)).toBe(100)
  })

  it('applies the entered percentage to the speed profile', () => {
    const shortened = makeUnit({
      orientation: 8,
      speedMultiplier: speedMultiplierFromPercent(90),
    })
    expect(topSpeed(shortened, attitude)).toBeCloseTo(SPEED_PROFILE[attitude].max * 0.9)
  })

  it('moves the ceiling on what a ship may be ordered to sail', () => {
    const base = makeUnit({ orientation: 8, maxTurnPoints: 0, prevMoveDistance: 0 })
    expect(furthest({ ...base, speedMultiplier: 0.5 })).toBeLessThan(furthest(base))
    expect(furthest({ ...base, speedMultiplier: 1.5 })).toBeGreaterThan(furthest(base))
  })

  it('moves the floor too, for a ship that has yet to move', () => {
    // The opening minimum is half the maximum, so a ship under more sail must
    // also commit to more way: the multiplier applies to both ends at once.
    const base = makeUnit({ orientation: 8, maxTurnPoints: 0, prevMoveDistance: null })
    const shortest = (u: Unit) =>
      Math.min(...enumerateMovementPlans(u, 0, null).map(totalOf))

    expect(shortest({ ...base, speedMultiplier: 1.5 })).toBeGreaterThan(shortest(base))
  })

  it('brings a ship to a standstill at 0', () => {
    const becalmed = makeUnit({ orientation: 8, speedMultiplier: 0 })
    expect(topSpeed(becalmed, attitude)).toBe(0)
    expect(enumerateMovementPlans(becalmed, 0, null).every((p) => totalOf(p) === 0)).toBe(true)
  })
})
