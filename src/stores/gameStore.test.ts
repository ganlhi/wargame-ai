import { describe, it, expect, beforeEach } from 'vitest'
import type { Unit } from '../types'

// The store reaches for localStorage at import time (zustand `persist`) and on
// save/load. A tiny in-memory stand-in keeps these tests in the default node
// environment without pulling in jsdom.
class MemoryStorage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  key(i: number) { return [...this.data.keys()][i] ?? null }
  getItem(k: string) { return this.data.get(k) ?? null }
  setItem(k: string, v: string) { this.data.set(k, String(v)) }
  removeItem(k: string) { this.data.delete(k) }
  clear() { this.data.clear() }
}
globalThis.localStorage = new MemoryStorage() as unknown as Storage

const { useGameStore } = await import('./gameStore')

function makeUnit(id: string, overrides: Partial<Unit> = {}): Unit {
  return {
    id,
    name: id,
    side: 'player',
    position: { x: 0, y: 0 },
    orientation: 0,
    status: 'active',
    aiStyle: 'cautious',
    maxTurnPoints: 6,
    foreAndAftRigged: false,
    speedProfile: {
      in_irons: { max: 0 }, beating: { max: 60 }, reaching: { max: 80 },
      quarter_reaching: { max: 100 }, running: { max: 90 },
    },
    driftSpeed: 10,
    baseWidth: 30,
    baseLength: 80,
    firingArcs: [{ id: `${id}-a`, side: 'starboard', maxRange: 300, weapons: 10 }],
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

const store = () => useGameStore.getState()

describe('gameStore — coordinate origin', () => {
  beforeEach(() => {
    localStorage.clear()
    useGameStore.setState({ savedGames: [], currentGame: null, hasUnsavedChanges: false })
    store().createGame('Test')
  })

  it('starts with no origin and adopts the first entity added', () => {
    expect(store().currentGame!.originId).toBeNull()
    store().addUnit(makeUnit('u1'))
    expect(store().currentGame!.originId).toBe('u1')
    store().addUnit(makeUnit('u2'))
    expect(store().currentGame!.originId).toBe('u1')
  })

  it('adopts a terrain piece when terrain is placed first', () => {
    store().addTerrain({
      type: 'island',
      center: { x: 0, y: 0 },
      shape: { kind: 'circle', width: 200, height: 200, rotation: 0 },
    })
    const t = store().currentGame!.terrain[0]
    expect(store().currentGame!.originId).toBe(t.id)
  })

  it('keeps the origin when it is destroyed or surrenders — the model is still on the table', () => {
    store().addUnit(makeUnit('u1'))
    store().addUnit(makeUnit('u2'))
    store().updateUnit('u1', { status: 'destroyed' })
    expect(store().currentGame!.originId).toBe('u1')
    store().updateUnit('u1', { status: 'surrendered' })
    expect(store().currentGame!.originId).toBe('u1')
  })

  it('reassigns the origin only when that entity is deleted', () => {
    store().addUnit(makeUnit('u1'))
    store().addUnit(makeUnit('u2'))
    store().removeUnit('u1')
    expect(store().currentGame!.originId).toBe('u2')
  })

  it('falls back to terrain, then to nothing, as entities are deleted', () => {
    store().addUnit(makeUnit('u1'))
    store().addTerrain({
      type: 'reef',
      center: { x: 100, y: 100 },
      shape: { kind: 'circle', width: 50, height: 50, rotation: 0 },
    })
    const terrainId = store().currentGame!.terrain[0].id
    store().removeUnit('u1')
    expect(store().currentGame!.originId).toBe(terrainId)
    store().removeTerrain(terrainId)
    expect(store().currentGame!.originId).toBeNull()
  })

  it('re-anchors on demand, and ignores an unknown id', () => {
    store().addUnit(makeUnit('u1'))
    store().addUnit(makeUnit('u2'))
    store().setOrigin('u2')
    expect(store().currentGame!.originId).toBe('u2')
    store().setOrigin('nope')
    expect(store().currentGame!.originId).toBe('u2')
  })
})

describe('gameStore — turn resolution on an infinite table', () => {
  beforeEach(() => {
    localStorage.clear()
    useGameStore.setState({ savedGames: [], currentGame: null, hasUnsavedChanges: false })
    store().createGame('Test')
  })

  it('logs positions relative to the origin *after* everyone has moved', () => {
    // The origin ship and a consort both sail 100mm east. Their relative
    // positions are unchanged, so the log must not show the consort drifting.
    const anchor = makeUnit('u1', { position: { x: 0, y: 0 }, orientation: 8 })
    const consort = makeUnit('u2', { position: { x: 500, y: 0 }, orientation: 8 })
    store().addUnit(anchor)
    store().addUnit(consort)
    store().setWindDirection(0) // from the north: heading east is reaching
    store().startGame()

    const straight100 = {
      chunks: [
        { distance: 20 }, { distance: 20 }, { distance: 20 }, { distance: 20 }, { distance: 20 },
      ],
      totalTurnPoints: 0,
      effectiveMaxSpeed: 100,
    } as Unit['playerOrder']

    store().setPlayerOrder('u1', straight100)
    store().setPlayerOrder('u2', straight100)
    store().revealOrders()
    store().resolveTurn()

    const game = store().currentGame!
    expect(game.units.find((u) => u.id === 'u1')!.position).toEqual({ x: 100, y: 0 })
    expect(game.units.find((u) => u.id === 'u2')!.position).toEqual({ x: 600, y: 0 })

    const log = game.actionLog.filter((e) => e.turn === 1)
    expect(log.find((e) => e.unitId === 'u1')!.text).toContain('moved to origin')
    expect(log.find((e) => e.unitId === 'u2')!.text).toContain('moved to 500mm E')
  })

  it('lets ships sail into negative coordinates without clamping', () => {
    const anchor = makeUnit('u1', { position: { x: 0, y: 0 }, orientation: 24 }) // bow west
    store().addUnit(anchor)
    store().setWindDirection(0)
    store().startGame()
    store().setPlayerOrder('u1', {
      chunks: [
        { distance: 20 }, { distance: 20 }, { distance: 20 }, { distance: 20 }, { distance: 20 },
      ],
      totalTurnPoints: 0,
      effectiveMaxSpeed: 100,
    })
    store().revealOrders()
    store().resolveTurn()

    expect(store().currentGame!.units[0].position.x).toBe(-100)
  })
})
