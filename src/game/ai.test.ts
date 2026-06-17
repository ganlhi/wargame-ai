import { describe, it, expect } from 'vitest'
import { evaluatePosition, suggestMovement } from './ai'
import type { Unit, Attitude, SpeedRange, FiringArc } from '../types'

const SPEED_PROFILE: Record<Attitude, SpeedRange> = {
  in_irons: { max: 0 },
  beating: { max: 60 },
  reaching: { max: 80 },
  quarter_reaching: { max: 100 },
  running: { max: 90 },
}

const STARBOARD_ARC: FiringArc = { id: 'a1', side: 'starboard', maxRange: 300, weapons: 10 }

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'u1',
    name: 'Test',
    side: 'ai',
    position: { x: 500, y: 500 },
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

describe('evaluatePosition', () => {
  const enemy = makeUnit({ id: 'e1', side: 'player', position: { x: 500, y: 500 }, firingArcs: [STARBOARD_ARC] })

  it('rewards an aggressive ship for being closer to the enemy', () => {
    const near = makeUnit({ aiStyle: 'aggressive', position: { x: 500, y: 460 } })
    const far = makeUnit({ aiStyle: 'aggressive', position: { x: 500, y: 150 } })
    const sNear = evaluatePosition(near, [enemy], [], 1000, 1000)
    const sFar = evaluatePosition(far, [enemy], [], 1000, 1000)
    expect(sNear).toBeGreaterThan(sFar)
  })

  it('rewards a defensive ship for keeping its distance', () => {
    const near = makeUnit({ aiStyle: 'defensive', position: { x: 500, y: 460 } })
    const far = makeUnit({ aiStyle: 'defensive', position: { x: 500, y: 150 } })
    const sNear = evaluatePosition(near, [enemy], [], 1000, 1000)
    const sFar = evaluatePosition(far, [enemy], [], 1000, 1000)
    expect(sFar).toBeGreaterThan(sNear)
  })

  it('rewards a faster point of sail, all else equal', () => {
    // Same position/heading/enemies — only the end-of-turn attitude differs.
    const fast = makeUnit({ attitude: 'quarter_reaching' })
    const slow = makeUnit({ attitude: 'beating' })
    const sFast = evaluatePosition(fast, [], [], 1000, 1000)
    const sSlow = evaluatePosition(slow, [], [], 1000, 1000)
    expect(sFast).toBeGreaterThan(sSlow)
    // In irons (no headway) is the worst attitude to end on.
    const irons = makeUnit({ attitude: 'in_irons' })
    expect(evaluatePosition(irons, [], [], 1000, 1000)).toBeLessThan(sSlow)
  })

  it('does not let attitude override a clearly better position', () => {
    // A slow attitude in a strong firing position must still beat a fast
    // attitude with no firing solution — attitude only breaks ties.
    const inPosition = makeUnit({
      attitude: 'beating',
      position: { x: 500, y: 460 },
      orientation: 0,
      firingArcs: [STARBOARD_ARC],
    })
    const fastButIdle = makeUnit({
      attitude: 'quarter_reaching',
      position: { x: 500, y: 150 },
      firingArcs: [STARBOARD_ARC],
    })
    const sIn = evaluatePosition(inPosition, [enemy], [], 1000, 1000)
    const sIdle = evaluatePosition(fastButIdle, [enemy], [], 1000, 1000)
    expect(sIn).toBeGreaterThan(sIdle)
  })
})

describe('suggestMovement', () => {
  const enemy = makeUnit({ id: 'e1', side: 'player', position: { x: 600, y: 500 }, firingArcs: [STARBOARD_ARC] })

  it('returns null for a unit that cannot act', () => {
    for (const status of ['destroyed', 'surrendered', 'grappled'] as const) {
      const unit = makeUnit({ status, firingArcs: [STARBOARD_ARC] })
      expect(suggestMovement(unit, [unit, enemy], [], 0, 1000, 1000, null)).toBeNull()
    }
  })

  it('returns a valid 5-chunk plan for an active unit', () => {
    const unit = makeUnit({ aiStyle: 'aggressive', firingArcs: [STARBOARD_ARC] })
    const result = suggestMovement(unit, [unit, enemy], [], 0, 1000, 1000, null)
    expect(result).not.toBeNull()
    expect(result!.chunks).toHaveLength(5)
    expect(result!.totalTurnPoints).toBeLessThanOrEqual(unit.maxTurnPoints)
  })

  it('keeps an immobilised unit stationary (all-zero chunks)', () => {
    const unit = makeUnit({ status: 'immobilised', firingArcs: [STARBOARD_ARC] })
    const result = suggestMovement(unit, [unit, enemy], [], 0, 1000, 1000, null)
    expect(result).not.toBeNull()
    expect(result!.chunks.every((c) => c.distance === 0)).toBe(true)
  })
})
