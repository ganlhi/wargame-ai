import { describe, it, expect } from 'vitest'
import { computeAIFirePlan } from './combat'
import type { Unit, Attitude, SpeedRange, FiringArc, MovementPlan, ArcSide } from '../types'

const SPEED_PROFILE: Record<Attitude, SpeedRange> = {
  in_irons: { max: 0 }, beating: { max: 60 }, reaching: { max: 80 },
  quarter_reaching: { max: 100 }, running: { max: 90 },
}

/** Both broadsides, 300mm, so only bearing and reloading decide the shot. */
const BROADSIDES: FiringArc[] = [
  { id: 'p', side: 'port', maxRange: 300, weapons: 10 },
  { id: 's', side: 'starboard', maxRange: 300, weapons: 10 },
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
    maxTurnPoints: 6, foreAndAftRigged: false, speedProfile: SPEED_PROFILE,
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
      targetId: 'east', chunkIndex: 0, arcSide: 'starboard',
    })
  })

  it('holds an arc that fired last turn until that chunk comes round again', () => {
    const ai = firer({ starboard: 2 })
    expect(computeAIFirePlan(ai, [ai, toStarboard], 0)).toEqual({
      targetId: 'east', chunkIndex: 2, arcSide: 'starboard',
    })
  })

  it('lets the other side fire straight away while one is reloading', () => {
    // Starboard is out until chunk 2, but the port guns never fired.
    const ai = firer({ starboard: 2 })
    expect(computeAIFirePlan(ai, [ai, toStarboard, toPort], 0)).toEqual({
      targetId: 'west', chunkIndex: 0, arcSide: 'port',
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
      targetId: 'east', chunkIndex: 4, arcSide: 'starboard',
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
        { id: 'p', side: 'port', maxRange: 300, weapons: 4 },
        { id: 's', side: 'starboard', maxRange: 300, weapons: 12 },
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
