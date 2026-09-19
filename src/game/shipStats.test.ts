import { describe, it, expect } from 'vitest'
import type { GameState, Unit } from '../types'
import { driftSpeed, gunRanges, speedProfile, turnPoints } from '../data/binder'
import { conditionsOf, resolveArcs, resolveGame, resolveUnit, shipStats } from './shipStats'

// Wind from the north; the fixture heads east, so she is reaching.
const CONDITIONS = { scale: '1/1200', windStrength: 'moderate_breeze', windDirection: 0 } as const

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'u1',
    name: 'Test',
    side: 'ai',
    position: { x: 0, y: 0 },
    orientation: 8,
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
    tackDirection: null,
    prevAttitude: 'reaching',
    prevMoveDistance: null,
    turnPointsOverride: null,
    tackingForbidden: false,
    aiOrder: null,
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
    phase: 'input',
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
    const gale = resolveUnit(makeUnit(), { ...CONDITIONS, windStrength: 'gale' })
    expect(gale.shipType).toBe('rate_3')
    expect(gale.speedProfile).toEqual(speedProfile('rate_3', 'gale', '1/1200'))
  })

  it('re-reads her guns at the scale, so an imported ship shoots at this game\'s distances', () => {
    const larger = resolveUnit(makeUnit(), { ...CONDITIONS, scale: '1/700' })
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

  // Her turning is the one charted figure a player may overrule, for damage
  // the charts know nothing about — so it has to survive the re-rate that
  // throws every other cached figure away.
  it('keeps a turning limit entered for a ship whose steering has suffered', () => {
    const crippled = resolveUnit(makeUnit({ turnPointsOverride: 1 }), CONDITIONS)
    expect(crippled.maxTurnPoints).toBe(1)
    expect(crippled.turnPointsOverride).toBe(1)
    // Everything else is still read straight off the charts.
    expect(crippled.driftSpeed).toBe(driftSpeed('rate_3', 'moderate_breeze', '1/1200'))
    // Including none at all: a ship that cannot turn is not a ship with no limit.
    expect(resolveUnit(makeUnit({ turnPointsOverride: 0 }), CONDITIONS).maxTurnPoints).toBe(0)
    // And a limit lifted goes back to the chart.
    expect(resolveUnit(makeUnit({ turnPointsOverride: null }), CONDITIONS).maxTurnPoints).toBe(
      turnPoints('rate_3'),
    )
  })

  it('reads her attitude off her heading and the wind, head to wind included', () => {
    // Heading east in a northerly: reaching. Swing the wind round to the east
    // and she is in irons, which the cached flag follows.
    const reaching = resolveUnit(makeUnit(), CONDITIONS)
    expect(reaching.attitude).toBe('reaching')
    expect(reaching.isInIrons).toBe(false)
    const irons = resolveUnit(makeUnit(), { ...CONDITIONS, windDirection: 8 })
    expect(irons.attitude).toBe('in_irons')
    expect(irons.isInIrons).toBe(true)
    // A fore-and-aft rig points a point higher.
    const foreAft = resolveUnit(makeUnit({ orientation: 5, foreAndAftRigged: true }), CONDITIONS)
    expect(foreAft.attitude).toBe('beating')
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
