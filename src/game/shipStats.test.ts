import { describe, it, expect } from 'vitest'
import type { GameState, Unit } from '../types'
import { driftSpeed, gunRanges, speedProfile, turnPoints } from '../data/binder'
import { conditionsOf, resolveArcs, resolveGame, resolveUnit, shipStats } from './shipStats'

const CONDITIONS = { scale: '1/1200', windStrength: 'moderate_breeze' } as const

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'u1',
    name: 'Test',
    side: 'ai',
    position: { x: 0, y: 0 },
    orientation: 0,
    status: 'active',
    aiStyle: 'cautious',
    shipType: 'rate_3',
    ...shipStats('rate_3', CONDITIONS),
    foreAndAftRigged: false,
    speedMultiplier: 1,
    baseWidth: 30,
    baseLength: 80,
    firingArcs: [
      {
        id: 'a1',
        side: 'starboard',
        guns: [{ id: 'g1', type: 'long_24', guns: 14, ranges: gunRanges('long_24', '1/1200') }],
      },
    ],
    attitude: 'reaching',
    isInIrons: false,
    grappledWith: null,
    tackDirection: null,
    prevAttitude: 'reaching',
    prevMoveDistance: null,
    hiddenAIOrder: null,
    playerOrder: null,
    lastFireChunks: {},
    hiddenAIFirePlan: null,
    hiddenAIAction: null,
    ...overrides,
  }
}

function makeGame(units: Unit[], overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'g1',
    name: 'Test',
    createdAt: '',
    updatedAt: '',
    schemaVersion: 11,
    originId: units[0]?.id ?? null,
    windDirection: 0,
    windStrength: 'moderate_breeze',
    scale: '1/1200',
    terrain: [],
    units,
    currentTurn: 1,
    currentPhase: 'orders',
    actionLog: [],
    ...overrides,
  }
}

describe('shipStats', () => {
  it('reads speeds, drift and turning off the charts for the ship and the conditions', () => {
    expect(shipStats('rate_3', CONDITIONS)).toEqual({
      maxTurnPoints: turnPoints('rate_3'),
      speedProfile: speedProfile('rate_3', 'moderate_breeze', '1/1200'),
      driftSpeed: driftSpeed('rate_3', 'moderate_breeze', '1/1200'),
    })
  })
})

describe('resolveUnit', () => {
  it('brings a ship whose type has changed back in line with the charts', () => {
    const cutter = resolveUnit(makeUnit({ shipType: 'cutter' }), CONDITIONS)
    expect(cutter.maxTurnPoints).toBe(turnPoints('cutter'))
    expect(cutter.speedProfile).toEqual(speedProfile('cutter', 'moderate_breeze', '1/1200'))
    expect(cutter.driftSpeed).toBe(driftSpeed('cutter', 'moderate_breeze', '1/1200'))
  })

  it('re-rates her for the weather without touching her type', () => {
    const gale = resolveUnit(makeUnit(), { scale: '1/1200', windStrength: 'gale' })
    expect(gale.shipType).toBe('rate_3')
    expect(gale.speedProfile).toEqual(speedProfile('rate_3', 'gale', '1/1200'))
  })

  it('re-reads her guns at the scale, so an imported ship shoots at this game\'s distances', () => {
    const larger = resolveUnit(makeUnit(), { scale: '1/700', windStrength: 'moderate_breeze' })
    expect(larger.firingArcs[0].guns[0].ranges).toEqual(gunRanges('long_24', '1/700'))
    expect(larger.firingArcs[0].guns[0].guns, 'how many guns is hers, not the charts').toBe(14)
  })

  it('throws away figures that were tampered with, since they are a cache and not a setting', () => {
    const doctored = makeUnit({ maxTurnPoints: 99, driftSpeed: 1 })
    const resolved = resolveUnit(doctored, CONDITIONS)
    expect(resolved.maxTurnPoints).toBe(turnPoints('rate_3'))
    expect(resolved.driftSpeed).toBe(driftSpeed('rate_3', 'moderate_breeze', '1/1200'))
  })

  it('hands back the very same ship when nothing needs changing', () => {
    const unit = makeUnit()
    expect(resolveUnit(unit, CONDITIONS)).toBe(unit)
  })
})

describe('resolveGame', () => {
  it('re-rates every ship against the game she is in', () => {
    const game = makeGame([makeUnit({ id: 'u1' }), makeUnit({ id: 'u2', shipType: 'brig' })])
    const gale = resolveGame({ ...game, windStrength: 'gale' })
    expect(gale.units[0].speedProfile).toEqual(speedProfile('rate_3', 'gale', '1/1200'))
    expect(gale.units[1].speedProfile).toEqual(speedProfile('brig', 'gale', '1/1200'))
  })

  it('hands back the very same game when every ship is already true to the charts', () => {
    const game = makeGame([makeUnit()])
    expect(resolveGame(game)).toBe(game)
  })

  it('takes the conditions off the game', () => {
    expect(conditionsOf(makeGame([]))).toEqual(CONDITIONS)
  })
})

describe('resolveArcs', () => {
  it('leaves an armament of nothing alone', () => {
    expect(resolveArcs([], '1/700')).toEqual([])
  })
})
