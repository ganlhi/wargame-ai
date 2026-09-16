import { describe, it, expect } from 'vitest'
import {
  COMPASS_16, formatBearing, formatDisplacement, fromBearing, originName, originPoint, toBearing,
  unitReferencePoint,
} from './coordinates'
import type { GameState, TableTerrain, Unit } from '../types'

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'u1',
    name: 'Test',
    side: 'player',
    position: { x: 0, y: 0 },
    orientation: 0,
    status: 'active',
    aiStyle: 'cautious',
    shipType: 'rate_4', maxTurnPoints: 6,
    foreAndAftRigged: false,
    speedProfile: {
      in_irons: { max: 0 }, beating: { max: 60 }, reaching: { max: 80 },
      quarter_reaching: { max: 100 }, running: { max: 90 },
    },
    speedMultiplier: 1,
    driftSpeed: 10,
    baseWidth: 30,
    baseLength: 80,
    firingArcs: [],
    attitude: 'reaching',
    isInIrons: false,
    tackDirection: null,
    prevAttitude: null,
    prevMoveDistance: null,
    aiOrder: null,
    ...overrides,
  }
}

const terrain: TableTerrain = {
  id: 't1',
  type: 'island',
  center: { x: 300, y: -200 },
  shape: { kind: 'circle', width: 100, height: 100, rotation: 0 },
}

function makeGame(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'g1',
    name: 'Test',
    createdAt: '', updatedAt: '', schemaVersion: 12,
    originId: null,
    windDirection: 0,
    windStrength: 'moderate_breeze',
    scale: '1/1200',
    terrain: [],
    units: [],
    phase: 'input',
    ...overrides,
  }
}

const O = { x: 0, y: 0 }

describe('toBearing', () => {
  it('reads the cardinal points off the world frame (+x east, +y south)', () => {
    expect(toBearing({ x: 0, y: -420 }, O)).toEqual({ direction: COMPASS_16.indexOf('N'), distance: 420 })
    expect(toBearing({ x: 420, y: 0 }, O)).toEqual({ direction: COMPASS_16.indexOf('E'), distance: 420 })
    expect(toBearing({ x: 0, y: 420 }, O)).toEqual({ direction: COMPASS_16.indexOf('S'), distance: 420 })
    expect(toBearing({ x: -420, y: 0 }, O)).toEqual({ direction: COMPASS_16.indexOf('W'), distance: 420 })
  })

  it('rounds to the nearest of the 16 points and the nearest millimetre', () => {
    // 10° west of north is nearer N (0°) than NNW (337.5°).
    const tenDeg = (10 * Math.PI) / 180
    expect(toBearing({ x: -Math.sin(tenDeg) * 300, y: -Math.cos(tenDeg) * 300 }, O)).toEqual({
      direction: COMPASS_16.indexOf('N'), distance: 300,
    })
    // 15° west of north is nearer NNW (22.5° off) than N.
    const fifteen = (15 * Math.PI) / 180
    expect(toBearing({ x: -Math.sin(fifteen) * 300, y: -Math.cos(fifteen) * 300 }, O).direction)
      .toBe(COMPASS_16.indexOf('NNW'))
    expect(toBearing({ x: 100.4, y: 0 }, O).distance).toBe(100)
  })

  it('measures from the origin given, not from the world origin', () => {
    expect(toBearing({ x: 500, y: 100 }, { x: 200, y: 100 })).toEqual({
      direction: COMPASS_16.indexOf('E'), distance: 300,
    })
  })

  it('reads the origin itself as north at nothing', () => {
    expect(toBearing({ x: 0.2, y: -0.3 }, O)).toEqual({ direction: 0, distance: 0 })
  })
})

describe('fromBearing', () => {
  it('lays a bearing back out in the world frame', () => {
    const e = fromBearing({ direction: COMPASS_16.indexOf('E'), distance: 100 }, O)
    // `+ 0` normalises -0, which deep equality distinguishes.
    expect(Math.round(e.x) + 0).toBe(100)
    expect(Math.round(e.y) + 0).toBe(0)
    const nnw = fromBearing({ direction: COMPASS_16.indexOf('NNW'), distance: 100 }, { x: 10, y: 10 })
    expect(nnw.x).toBeLessThan(10)
    expect(nnw.y).toBeLessThan(10)
    expect(Math.hypot(nnw.x - 10, nnw.y - 10)).toBeCloseTo(100)
  })

  it('round-trips with toBearing on every point of the rose', () => {
    const origin = { x: -410, y: 96 }
    for (let direction = 0; direction < COMPASS_16.length; direction++) {
      const bearing = { direction, distance: 275 }
      expect(toBearing(fromBearing(bearing, origin), origin)).toEqual(bearing)
    }
  })
})

describe('formatBearing', () => {
  it('reads as a distance and a rose point, and the origin as origin', () => {
    expect(formatBearing({ direction: COMPASS_16.indexOf('NNW'), distance: 420 })).toBe('420 mm NNW')
    expect(formatBearing({ direction: 3, distance: 0 })).toBe('origin')
    expect(formatBearing({ direction: 3, distance: 0.4 })).toBe('origin')
  })
})

describe('formatDisplacement', () => {
  it('reads where a ship ends relative to where she started', () => {
    expect(formatDisplacement({ x: 0, y: 0 }, { x: 0, y: -182 })).toBe('182 mm N of her start')
    expect(formatDisplacement({ x: 50, y: 50 }, { x: 50, y: 50 })).toBe('where she started')
  })
})

describe('origin', () => {
  it('is (0, 0) for a game with no ships, so world and relative coordinates coincide', () => {
    expect(originPoint(makeGame())).toEqual({ x: 0, y: 0 })
    expect(originName(makeGame())).toBeNull()
  })

  it('is the origin ship\'s base centre, and she reads origin wherever she is', () => {
    const anchor = makeUnit({ position: { x: 500, y: 40 } })
    const game = makeGame({ originId: 'u1', units: [anchor] })
    expect(originPoint(game)).toEqual({ x: 500, y: 40 })
    expect(originName(game)).toBe('Test')
    expect(formatBearing(toBearing(unitReferencePoint(anchor), originPoint(game)))).toBe('origin')
  })

  it('reads every other entity as a bearing from her, which shifts as she is re-entered elsewhere', () => {
    const anchor = makeUnit({ id: 'u1', position: { x: 0, y: 0 } })
    const other = makeUnit({ id: 'u2', position: { x: 0, y: -320 } })

    const before = makeGame({ originId: 'u1', units: [anchor, other], terrain: [terrain] })
    expect(formatBearing(toBearing(unitReferencePoint(other), originPoint(before)))).toBe('320 mm N')
    // 300 east and 200 north is 56° off north: nearer ENE (56.25°) than NE.
    expect(formatBearing(toBearing(terrain.center, originPoint(before)))).toBe('361 mm ENE')

    // The anchor is re-entered 320mm further north; the consort now lies on her.
    const after = makeGame({ originId: 'u1', units: [{ ...anchor, position: { x: 0, y: -320 } }, other] })
    expect(formatBearing(toBearing(unitReferencePoint(other), originPoint(after)))).toBe('origin')
  })

  it('falls back to (0, 0) when originId dangles or names terrain', () => {
    expect(originPoint(makeGame({ originId: 'gone' }))).toEqual({ x: 0, y: 0 })
    expect(originPoint(makeGame({ originId: 't1', terrain: [terrain] }))).toEqual({ x: 0, y: 0 })
  })
})
