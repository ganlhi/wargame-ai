import { describe, it, expect } from 'vitest'
import {
  centerFromSternMidpoint, formatOffset, fromOffset, originPoint, sternMidpoint, toOffset,
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
    maxTurnPoints: 6,
    speedProfile: {
      in_irons: { max: 0 }, beating: { max: 60 }, reaching: { max: 80 },
      quarter_reaching: { max: 100 }, running: { max: 90 },
    },
    driftSpeed: 10,
    baseWidth: 30,
    baseLength: 80,
    firingArcs: [],
    attitude: 'reaching',
    isInIrons: false,
    grappledWith: null,
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
    createdAt: '', updatedAt: '', schemaVersion: 5,
    originId: null,
    windDirection: 0,
    terrain: [],
    units: [],
    currentTurn: 1,
    currentPhase: 'setup',
    actionLog: [],
    ...overrides,
  }
}

// `+ 0` normalises -0, which Math.round preserves and deep-equal distinguishes.
const approx = (p: { x: number; y: number }) => ({ x: Math.round(p.x) + 0, y: Math.round(p.y) + 0 })

describe('stern reference point', () => {
  it('sits half a base-length behind the centre, along the heading', () => {
    // Orientation 0 = bow to the north, so the stern is to the south (+y).
    expect(approx(sternMidpoint({ x: 0, y: 0 }, 0, 80))).toEqual({ x: 0, y: 40 })
    // Orientation 8 = bow east, stern to the west.
    expect(approx(sternMidpoint({ x: 0, y: 0 }, 8, 80))).toEqual({ x: -40, y: 0 })
  })

  it('round-trips with centerFromSternMidpoint at any heading', () => {
    for (const orientation of [0, 5, 8, 13, 21, 30]) {
      const center = { x: 137, y: -42 }
      const stern = sternMidpoint(center, orientation, 90)
      expect(approx(centerFromSternMidpoint(stern, orientation, 90))).toEqual(approx(center))
    }
  })
})

describe('origin', () => {
  it('is (0, 0) for an empty game, so world and relative coordinates coincide', () => {
    expect(originPoint(makeGame())).toEqual({ x: 0, y: 0 })
  })

  it('tracks the origin unit as it moves, keeping the unit itself at (0, 0)', () => {
    const start = makeUnit({ position: { x: 0, y: 40 }, orientation: 0 })
    const game = makeGame({ originId: 'u1', units: [start] })
    expect(approx(originPoint(game))).toEqual({ x: 0, y: 80 })
    expect(formatOffset(toOffset(unitReferencePoint(start), originPoint(game)))).toBe('origin')

    // Sail 500mm east. The origin ship still reads (0, 0).
    const moved = { ...start, position: { x: 500, y: 40 } }
    const movedGame = makeGame({ originId: 'u1', units: [moved] })
    expect(formatOffset(toOffset(unitReferencePoint(moved), originPoint(movedGame)))).toBe('origin')
  })

  it('reports other entities relative to the origin, so they shift as it moves', () => {
    const anchor = makeUnit({ id: 'u1', position: { x: 0, y: 40 }, orientation: 0 })
    const other = makeUnit({ id: 'u2', position: { x: 320, y: 230 }, orientation: 0 })

    const before = makeGame({ originId: 'u1', units: [anchor, other], terrain: [terrain] })
    expect(formatOffset(toOffset(unitReferencePoint(other), originPoint(before)))).toBe('320mm E · 190mm S')
    expect(formatOffset(toOffset(terrain.center, originPoint(before)))).toBe('300mm E · 280mm N')

    // The anchor sails 100mm east; every other reading moves 100mm west.
    const after = makeGame({
      originId: 'u1',
      units: [{ ...anchor, position: { x: 100, y: 40 } }, other],
      terrain: [terrain],
    })
    expect(formatOffset(toOffset(unitReferencePoint(other), originPoint(after)))).toBe('220mm E · 190mm S')
  })

  it('falls back to (0, 0) when originId dangles', () => {
    expect(originPoint(makeGame({ originId: 'gone' }))).toEqual({ x: 0, y: 0 })
  })
})

describe('formatOffset', () => {
  it('labels each axis by compass direction and drops axes at the origin', () => {
    expect(formatOffset({ east: 320, south: 150 })).toBe('320mm E · 150mm S')
    expect(formatOffset({ east: -80, south: -40 })).toBe('80mm W · 40mm N')
    expect(formatOffset({ east: 0, south: -40 })).toBe('40mm N')
    expect(formatOffset({ east: 0, south: 0 })).toBe('origin')
  })
})

describe('toOffset / fromOffset', () => {
  it('round-trip through an arbitrary origin', () => {
    const origin = { x: -410, y: 96 }
    const world = { x: 12, y: -304 }
    expect(fromOffset(toOffset(world, origin), origin)).toEqual(world)
  })
})
