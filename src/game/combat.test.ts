import { describe, it, expect } from 'vitest'
import { bestShotDuringMove } from './combat'
import type { Unit, Attitude, SpeedRange, FiringArc, GunProfile, MovementPlan } from '../types'

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
 * so only bearing and range decide the shot.
 */
const BROADSIDES: FiringArc[] = [
  { id: 'p', side: 'port', guns: [gun('p-g', 10, 300)] },
  { id: 's', side: 'starboard', guns: [gun('s-g', 10, 300)] },
]

/** Nobody moves, so the geometry is the same on every step of the turn. */
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
    attitude: 'reaching', isInIrons: false, tackDirection: null,
    prevAttitude: 'reaching', prevMoveDistance: 0,
    aiOrder: null,
    ...overrides,
  }
}

// Bow north. The starboard broadside therefore bears east, the port one west.
const firer = makeUnit({ id: 'ai1', side: 'ai' })
const toStarboard = makeUnit({ id: 'east', side: 'player', position: { x: 200, y: 0 } })
const toPort = makeUnit({ id: 'west', side: 'player', position: { x: -200, y: 0 } })

describe('bestShotDuringMove', () => {
  it('finds the arc that bears, on the first step it bears', () => {
    expect(bestShotDuringMove(firer, STATIONARY, [toStarboard], 0)).toMatchObject({
      targetId: 'east', arcSide: 'starboard', chunkIndex: 0, band: 'close',
    })
    expect(bestShotDuringMove(firer, STATIONARY, [toPort], 0)).toMatchObject({
      targetId: 'west', arcSide: 'port', chunkIndex: 0,
    })
  })

  it('finds nothing when nothing bears, or when the target is out of range', () => {
    // Dead ahead: neither broadside bears and there are no chase guns.
    const ahead = makeUnit({ id: 'north', side: 'player', position: { x: 0, y: -200 } })
    expect(bestShotDuringMove(firer, STATIONARY, [ahead], 0)).toBeNull()
    const distant = makeUnit({ id: 'far', side: 'player', position: { x: 5000, y: 0 } })
    expect(bestShotDuringMove(firer, STATIONARY, [distant], 0)).toBeNull()
  })

  it('picks the heavier arc when both bear', () => {
    const lopsided = makeUnit({
      id: 'ai1',
      firingArcs: [
        { id: 'p', side: 'port', guns: [gun('p-g', 4, 300)] },
        { id: 's', side: 'starboard', guns: [gun('s-g', 12, 300)] },
      ],
    })
    expect(bestShotDuringMove(lopsided, STATIONARY, [toPort, toStarboard], 0)).toMatchObject({
      arcSide: 'starboard', effectiveGuns: 12,
    })
  })

  it('ignores its own side and ships already out of the fight', () => {
    const friend = makeUnit({ id: 'friend', side: 'ai', position: { x: 200, y: 0 } })
    expect(bestShotDuringMove(firer, STATIONARY, [friend], 0)).toBeNull()
    for (const status of ['destroyed', 'surrendered'] as const) {
      const wreck = makeUnit({ id: 'wreck', side: 'player', position: { x: 200, y: 0 }, status })
      expect(bestShotDuringMove(firer, STATIONARY, [wreck], 0)).toBeNull()
    }
  })

  it('sees a shot that only opens up part-way through the move', () => {
    // Sailing north past a ship lying to the east and ahead: the broadside
    // bears only once she has drawn level, on a later step.
    const passing = makeUnit({ id: 'east', side: 'player', position: { x: 150, y: -120 } })
    const north: MovementPlan = {
      chunks: [{ distance: 30 }, { distance: 30 }, { distance: 30 }, { distance: 30 }, { distance: 30 }],
      totalTurnPoints: 0,
      effectiveMaxSpeed: 150,
    }
    const shot = bestShotDuringMove(firer, north, [passing], 0)
    expect(shot).not.toBeNull()
    expect(shot!.chunkIndex).toBeGreaterThan(0)
    expect(shot!.arcSide).toBe('starboard')
  })

  it('weighs a closer shot over an earlier one', () => {
    // Sailing east with a target ahead and to starboard: the broadside bears
    // from early in the move, but the range keeps closing and only the last
    // step brings it inside close range, so that is the heaviest shot.
    const shortRanged: FiringArc[] = [{ id: 's', side: 'starboard', guns: [gun('s-g', 10, 202, 600)] }]
    const closing = makeUnit({ id: 'ai1', orientation: 8, firingArcs: shortRanged })
    const target = makeUnit({ id: 'south', side: 'player', position: { x: 120, y: 200 } })
    const east: MovementPlan = {
      chunks: [{ distance: 20 }, { distance: 20 }, { distance: 20 }, { distance: 20 }, { distance: 20 }],
      totalTurnPoints: 0,
      effectiveMaxSpeed: 100,
    }
    const shot = bestShotDuringMove(closing, east, [target], 0)
    expect(shot!.arcSide).toBe('starboard')
    expect(shot!.chunkIndex).toBe(4)
    expect(shot!.band).toBe('close')
  })

  it('takes the earliest of equally heavy shots', () => {
    expect(bestShotDuringMove(firer, STATIONARY, [toStarboard], 0)!.chunkIndex).toBe(0)
  })

  it('prefers a raking shot to a broadside of the same weight', () => {
    // Two targets at the same range: one beam-on, one showing her stern to the guns.
    const beamOn = makeUnit({ id: 'beam', side: 'player', position: { x: 200, y: 0 }, orientation: 0 })
    const sternOn = makeUnit({ id: 'stern', side: 'player', position: { x: -200, y: 0 }, orientation: 8 })
    const shot = bestShotDuringMove(firer, STATIONARY, [beamOn, sternOn], 0)
    expect(shot).toMatchObject({ targetId: 'stern', raking: true })
  })
})
