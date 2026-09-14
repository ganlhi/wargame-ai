import { describe, it, expect } from 'vitest'
import { computeAIFirePlan } from './combat'
import type { Unit, Attitude, SpeedRange, FiringArc, GunProfile, MovementPlan, ArcSide } from '../types'

const SPEED_PROFILE: Record<Attitude, SpeedRange> = {
  in_irons: { max: 0 }, beating: { max: 60 }, reaching: { max: 80 },
  quarter_reaching: { max: 100 }, running: { max: 90 },
}

function gun(id: string, guns: number, close: number, reach = close * 3): GunProfile {
  return {
    id,
    type: 'long_24',
    guns,
    ranges: { point_blank: 20, close, medium: close * 1.5, long: close * 2, extreme: reach },
  }
}

/**
 * Both broadsides, and everything the tests place is well inside close range,
 * so only bearing and reloading decide the shot.
 */
const BROADSIDES: FiringArc[] = [
  { id: 'p', side: 'port', guns: [gun('p-g', 10, 300)] },
  { id: 's', side: 'starboard', guns: [gun('s-g', 10, 300)] },
]

/** Nobody moves, so the geometry is the same on every chunk of the turn. */
const STATIONARY: MovementPlan = {
  chunks: [{ distance: 0 }, { distance: 0 }, { distance: 0 }, { distance: 0 }, { distance: 0 }],
  totalTurnPoints: 0,
  effectiveMaxSpeed: 0,
}

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'u1', name: 'Test', side: 'ai',
    position: { x: 0, y: 0 }, orientation: 0, status: 'active', aiStyle: 'aggressive',
    shipType: 'rate_4', maxTurnPoints: 6, foreAndAftRigged: false, speedProfile: SPEED_PROFILE,
    speedMultiplier: 1,
    driftSpeed: 10, baseWidth: 30, baseLength: 80, firingArcs: BROADSIDES,
    attitude: 'reaching', isInIrons: false, grappledWith: null, tackDirection: null,
    prevAttitude: 'reaching', prevMoveDistance: 0,
    hiddenAIOrder: null, playerOrder: null, lastFireChunks: {},
    hiddenAIFirePlan: null, hiddenAIAction: null,
    ...overrides,
  }
}

// Bow north. The starboard broadside therefore bears east, the port bow west.
const firer = (lastFireChunks: Partial<Record<ArcSide, number>> = {}) =>
  makeUnit({ id: 'ai1', side: 'ai', hiddenAIOrder: STATIONARY, lastFireChunks })

const toStarboard = makeUnit({ id: 'east', side: 'player', position: { x: 200, y: 0 } })
const toPort = makeUnit({ id: 'west', side: 'player', position: { x: -200, y: 0 } })

describe('computeAIFirePlan', () => {
  it('fires at the first chunk when everything is loaded', () => {
    const ai = firer()
    expect(computeAIFirePlan(ai, [ai, toStarboard], 0)).toEqual({
      targetId: 'east', chunkIndex: 0, arcSide: 'starboard', band: 'close', effectiveGuns: 10,
    })
  })

  it('holds an arc that fired last turn until that chunk comes round again', () => {
    const ai = firer({ starboard: 2 })
    expect(computeAIFirePlan(ai, [ai, toStarboard], 0)).toEqual({
      targetId: 'east', chunkIndex: 2, arcSide: 'starboard', band: 'close', effectiveGuns: 10,
    })
  })

  it('lets the other side fire straight away while one is reloading', () => {
    // Starboard is out until chunk 2, but the port guns never fired.
    const ai = firer({ starboard: 2 })
    expect(computeAIFirePlan(ai, [ai, toStarboard, toPort], 0)).toEqual({
      targetId: 'west', chunkIndex: 0, arcSide: 'port', band: 'close', effectiveGuns: 10,
    })
  })

  it('reloading one arc does not silence the ship', () => {
    // The bug this replaces: a per-ship reload blocked every arc, so a ship
    // that fired late in a turn could not fire at all in the next.
    const ai = firer({ starboard: 4 })
    const plan = computeAIFirePlan(ai, [ai, toStarboard, toPort], 0)
    expect(plan).not.toBeNull()
    expect(plan!.arcSide).toBe('port')
    expect(plan!.chunkIndex).toBe(0)
  })

  it('still fires on the last chunk when that is when the arc comes back', () => {
    const ai = makeUnit({
      id: 'ai1', hiddenAIOrder: STATIONARY, lastFireChunks: { starboard: 4 },
      firingArcs: [BROADSIDES[1]], // starboard only
    })
    expect(computeAIFirePlan(ai, [ai, toStarboard], 0)).toEqual({
      targetId: 'east', chunkIndex: 4, arcSide: 'starboard', band: 'close', effectiveGuns: 10,
    })
  })

  it('holds fire when nothing bears, or when the target is out of range', () => {
    const ai = firer()
    const ahead = makeUnit({ id: 'north', side: 'player', position: { x: 0, y: -200 } })
    expect(computeAIFirePlan(ai, [ai, ahead], 0)).toBeNull()

    const distant = makeUnit({ id: 'far', side: 'player', position: { x: 5000, y: 0 } })
    expect(computeAIFirePlan(ai, [ai, distant], 0)).toBeNull()
  })

  it('picks the heavier arc when both bear', () => {
    const ai = makeUnit({
      id: 'ai1', hiddenAIOrder: STATIONARY,
      firingArcs: [
        { id: 'p', side: 'port', guns: [gun('p-g', 4, 300)] },
        { id: 's', side: 'starboard', guns: [gun('s-g', 12, 300)] },
      ],
    })
    expect(computeAIFirePlan(ai, [ai, toStarboard], 0)?.arcSide).toBe('starboard')
  })

  it('ignores its own side and ships already out of the fight', () => {
    const ai = firer()
    const friend = makeUnit({ id: 'friend', side: 'ai', position: { x: 200, y: 0 } })
    expect(computeAIFirePlan(ai, [ai, friend], 0)).toBeNull()

    for (const status of ['destroyed', 'surrendered'] as const) {
      const wreck = makeUnit({ id: 'wreck', side: 'player', position: { x: 200, y: 0 }, status })
      expect(computeAIFirePlan(ai, [ai, wreck], 0)).toBeNull()
    }
  })

  it('has nothing to plan without an order to simulate', () => {
    expect(computeAIFirePlan(makeUnit({ hiddenAIOrder: null }), [toStarboard], 0)).toBeNull()
  })
})

describe('computeAIFirePlan — choosing the shot', () => {
  /** One broadside whose bands are tight enough that the chunk chosen matters. */
  const shortRanged: FiringArc[] = [{ id: 's', side: 'starboard', guns: [gun('s-g', 10, 100, 400)] }]

  /** A ship under way at `perChunk` mm a chunk, holding her heading. */
  const runIn = (perChunk: number): MovementPlan => ({
    chunks: [
      { distance: perChunk }, { distance: perChunk }, { distance: perChunk },
      { distance: perChunk }, { distance: perChunk },
    ],
    totalTurnPoints: 0,
    effectiveMaxSpeed: perChunk * 5,
  })

  /**
   * An enemy running down on the AI from the east, so she stays on the
   * starboard beam throughout while the range shortens chunk by chunk.
   */
  const bearingDown = (from: number, perChunk: number) =>
    makeUnit({
      id: 'east', side: 'player', position: { x: from, y: 0 }, orientation: 24,
      playerOrder: runIn(perChunk),
    })

  it('waits for the closer shot rather than firing the first that bears', () => {
    const ai = makeUnit({ id: 'ai1', hiddenAIOrder: STATIONARY, firingArcs: shortRanged })
    // 340mm on the first chunk down to 100mm on the last.
    const target = bearingDown(400, 60)

    const plan = computeAIFirePlan(ai, [ai, target], 0)
    // The guns bear from the first chunk, but only at extreme range, where the
    // shot is worth a fourteenth of what it is worth once she is alongside.
    expect(plan).not.toBeNull()
    expect(plan!.chunkIndex).toBe(4)
    expect(plan!.band).toBe('close')
    expect(plan!.effectiveGuns).toBe(10)
  })

  it('takes the earliest of equally heavy shots, so the arc reloads sooner', () => {
    const ai = firer()
    expect(computeAIFirePlan(ai, [ai, toStarboard], 0)?.chunkIndex).toBe(0)
  })

  it('holds fire at extreme range while the range is still closing', () => {
    const ai = makeUnit({ id: 'ai1', hiddenAIOrder: STATIONARY, firingArcs: shortRanged })
    // 370mm down to 250mm: still extreme all the way, and still shortening —
    // so the broadside is worth keeping loaded for next turn.
    expect(computeAIFirePlan(ai, [ai, bearingDown(400, 30)], 0)).toBeNull()
  })

  it('fires what it has at extreme range when it will get no nearer', () => {
    const ai = makeUnit({
      id: 'ai1', hiddenAIOrder: STATIONARY, firingArcs: shortRanged,
    })
    const target = makeUnit({ id: 'east', side: 'player', position: { x: 380, y: 0 } })
    const plan = computeAIFirePlan(ai, [ai, target], 0)
    expect(plan?.band).toBe('extreme')
  })

  it('prefers the heavier weight of metal over the nearer band', () => {
    const ai = makeUnit({
      id: 'ai1', hiddenAIOrder: STATIONARY,
      firingArcs: [
        // A single bow chaser at close range against a whole broadside at long.
        { id: 'b', side: 'bow', guns: [gun('b-g', 1, 300)] },
        { id: 's', side: 'starboard', guns: [gun('s-g', 40, 100, 400)] },
      ],
    })
    const ahead = makeUnit({ id: 'north', side: 'player', position: { x: 0, y: -150 } })
    const abeam = makeUnit({ id: 'east', side: 'player', position: { x: 180, y: 0 } })

    const plan = computeAIFirePlan(ai, [ai, ahead, abeam], 0)
    expect(plan?.arcSide).toBe('starboard')
    expect(plan?.band).toBe('long')
  })
})
