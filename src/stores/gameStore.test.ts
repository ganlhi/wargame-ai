import { describe, it, expect, beforeEach } from 'vitest'
import type { ArcSide, FiringArc, Unit } from '../types'

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
const { buildTackPlan } = await import('../game/movement')

/**
 * An arc carrying one kind of gun, with the bands a single `extreme` range
 * implies: each one 60% of the band outside it, which is how the AI used to
 * derive its range tiers and what older saves migrate to.
 */
function makeArc(id: string, side: ArcSide, extreme = 300, guns = 10): FiringArc {
  return {
    id,
    side,
    guns: [
      {
        id: `${id}-g`,
        name: 'Guns',
        guns,
        ranges: {
          close: Math.round(extreme * 0.216),
          medium: Math.round(extreme * 0.36),
          long: Math.round(extreme * 0.6),
          extreme,
        },
      },
    ],
  }
}

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
    speedMultiplier: 1,
    driftSpeed: 10,
    baseWidth: 30,
    baseLength: 80,
    firingArcs: [makeArc(`${id}-a`, 'starboard')],
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

describe('gameStore — tacking', () => {
  beforeEach(() => {
    localStorage.clear()
    useGameStore.setState({ savedGames: [], currentGame: null, hasUnsavedChanges: false })
    store().createGame('Test')
  })

  const resolve = () => {
    store().revealOrders()
    store().resolveTurn()
    return store().currentGame!.units[0]
  }

  /** Wind from the north; orientation 6 is beating with the wind on the port bow. */
  const setUpBeatingShip = (overrides: Partial<Unit> = {}) => {
    store().addUnit(makeUnit('u1', { orientation: 6, maxTurnPoints: 2, driftSpeed: 50, ...overrides }))
    store().setWindDirection(0)
    store().startGame()
    return store().currentGame!.units[0]
  }

  it('carries a declared tack through resolution: drifting, in irons, still swinging', () => {
    const unit = setUpBeatingShip()
    expect(unit.attitude).toBe('beating')

    store().setPlayerOrder('u1', buildTackPlan(unit, 0))
    const after = resolve()

    expect(after.isInIrons).toBe(true)
    expect(after.tackDirection).toBe('port')
    expect(after.attitude).toBe('in_irons')
    // Wind from the north pushes her south, and she makes no way of her own.
    expect(after.position.y).toBe(50)
    expect(after.prevMoveDistance).toBe(0)
  })

  it('keeps a mid-tack ship coming about even with no order entered', () => {
    const unit = setUpBeatingShip()
    store().setPlayerOrder('u1', buildTackPlan(unit, 0))

    let after = resolve()
    const swungTo = after.orientation
    // No order at all for the next turn — the tack must continue regardless.
    after = resolve()

    expect(after.orientation).not.toBe(swungTo)
    expect(after.position.y).toBe(100)
    expect(after.tackDirection).toBe('port')
  })

  it('completes the tack on the far side and hands control back', () => {
    const unit = setUpBeatingShip()
    store().setPlayerOrder('u1', buildTackPlan(unit, 0))

    let after = resolve()
    for (let turn = 0; turn < 10 && after.isInIrons; turn++) after = resolve()

    expect(after.isInIrons).toBe(false)
    expect(after.tackDirection).toBeNull()
    expect(after.attitude).toBe('beating')
    // Six turns at two points each: round through 12 points onto the new tack.
    expect(after.orientation).toBe(26)
  })
})

describe('gameStore — reloading', () => {
  const STATIONARY = {
    chunks: [{ distance: 0 }, { distance: 0 }, { distance: 0 }, { distance: 0 }, { distance: 0 }],
    totalTurnPoints: 0,
    effectiveMaxSpeed: 0,
  } as Unit['hiddenAIOrder']

  const BROADSIDES = [
    makeArc('p', 'port'),
    makeArc('s', 'starboard'),
  ]

  const ai = () => store().currentGame!.units.find((u) => u.id === 'ai1')!

  beforeEach(() => {
    localStorage.clear()
    useGameStore.setState({ savedGames: [], currentGame: null, hasUnsavedChanges: false })
    store().createGame('Test')
    // Bow north, so the starboard broadside bears on a ship lying due east.
    store().addUnit(makeUnit('ai1', { side: 'ai', orientation: 0, firingArcs: BROADSIDES }))
    store().addUnit(makeUnit('p1', { position: { x: 200, y: 0 }, firingArcs: BROADSIDES }))
    store().startGame()
  })

  /** Reveal with a stationary AI order, so only the guns are under test. */
  const reveal = () => {
    store().updateUnit('ai1', { hiddenAIOrder: STATIONARY })
    store().revealOrders()
    return ai()
  }

  it('records which arc fired and on which chunk', () => {
    store().updateUnit('ai1', { lastFireChunks: { starboard: 3 } })
    const after = reveal()
    expect(after.hiddenAIFirePlan).toMatchObject({ arcSide: 'starboard', chunkIndex: 3 })
    expect(after.lastFireChunks).toEqual({ starboard: 3 })
  })

  it('loads every arc again after a turn in which the ship did not fire', () => {
    // Fired late last turn, and this turn there is nothing to shoot at.
    store().updateUnit('ai1', { lastFireChunks: { starboard: 4 } })
    store().updateUnit('p1', { position: { x: 100000, y: 0 } })

    const idle = reveal()
    expect(idle.hiddenAIFirePlan).toBeNull()
    expect(idle.lastFireChunks).toEqual({})

    // With the enemy back alongside, she fires from the first chunk again
    // rather than staying stuck on chunk 4 for the rest of the game.
    store().resolveTurn()
    store().updateUnit('p1', { position: { x: 200, y: 0 } })
    expect(reveal().hiddenAIFirePlan).toMatchObject({ arcSide: 'starboard', chunkIndex: 0 })
  })

  it('frees the arc that did not fire, holding only the one that did', () => {
    store().updateUnit('ai1', { lastFireChunks: { starboard: 2 } })
    store().addUnit(makeUnit('p2', { position: { x: -200, y: 0 }, firingArcs: BROADSIDES }))

    const after = reveal()
    expect(after.hiddenAIFirePlan).toMatchObject({ targetId: 'p2', arcSide: 'port', chunkIndex: 0 })
    expect(after.lastFireChunks).toEqual({ port: 0 })
  })
})
