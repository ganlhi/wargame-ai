import { describe, it, expect, beforeEach } from 'vitest'
import type { ArcSide, FiringArc, Unit } from '../types'
import { driftSpeed, speedProfile } from '../data/binder'

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
const { planSailedDistance } = await import('../game/movement')

function makeArc(id: string, side: ArcSide, extreme = 300, guns = 10): FiringArc {
  return {
    id,
    side,
    guns: [
      {
        id: `${id}-g`,
        type: 'long_24',
        guns,
        ranges: {
          point_blank: 20,
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
    orientation: 8,
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
    firingArcs: [makeArc(`${id}-a`, 'starboard')],
    attitude: 'reaching',
    isInIrons: false,
    tackDirection: null,
    prevAttitude: null,
    prevMoveDistance: null,
    aiOrder: null,
    ...overrides,
  }
}

const ISLAND = {
  type: 'island' as const,
  center: { x: 300, y: -200 },
  shape: { kind: 'circle' as const, width: 200, height: 200, rotation: 0 },
}

const store = () => useGameStore.getState()
const game = () => store().currentGame!
const unit = (id: string) => game().units.find((u) => u.id === id)!

const fresh = () => {
  localStorage.clear()
  useGameStore.setState({ savedGames: [], currentGame: null, hasUnsavedChanges: false })
  store().createGame('Test', '1/1200')
}

describe('gameStore — the origin ship', () => {
  beforeEach(fresh)

  it('starts with no origin and adopts the first ship added', () => {
    expect(game().originId).toBeNull()
    store().addUnit(makeUnit('u1'))
    expect(game().originId).toBe('u1')
    store().addUnit(makeUnit('u2'))
    expect(game().originId).toBe('u1')
  })

  it('refuses terrain until there is a ship to measure it from', () => {
    expect(store().addTerrain(ISLAND)).toBe(false)
    expect(game().terrain).toHaveLength(0)
    store().addUnit(makeUnit('u1'))
    expect(store().addTerrain(ISLAND)).toBe(true)
    expect(game().terrain).toHaveLength(1)
    // Terrain never becomes the origin.
    expect(game().originId).toBe('u1')
  })

  it('keeps the origin when she is destroyed or surrenders — the model is still on the table', () => {
    store().addUnit(makeUnit('u1'))
    store().addUnit(makeUnit('u2'))
    store().updateUnit('u1', { status: 'destroyed' })
    expect(game().originId).toBe('u1')
    store().updateUnit('u1', { status: 'surrendered' })
    expect(game().originId).toBe('u1')
  })

  it('hands the origin to the next ship only when she is deleted', () => {
    store().addUnit(makeUnit('u1'))
    store().addUnit(makeUnit('u2'))
    expect(store().removeUnit('u1')).toBe(true)
    expect(game().originId).toBe('u2')
    store().removeUnit('u2')
    expect(game().originId).toBeNull()
  })

  it('will not remove the last ship while terrain still needs an origin', () => {
    store().addUnit(makeUnit('u1'))
    store().addTerrain(ISLAND)
    expect(store().removeUnit('u1')).toBe(false)
    expect(game().units).toHaveLength(1)
    store().removeTerrain(game().terrain[0].id)
    expect(store().removeUnit('u1')).toBe(true)
  })

  it('re-anchors on another ship on demand, and never on terrain or an unknown id', () => {
    store().addUnit(makeUnit('u1'))
    store().addUnit(makeUnit('u2'))
    store().addTerrain(ISLAND)
    store().setOrigin('u2')
    expect(game().originId).toBe('u2')
    store().setOrigin(game().terrain[0].id)
    expect(game().originId).toBe('u2')
    store().setOrigin('nope')
    expect(game().originId).toBe('u2')
  })

  it('never moves a ship itself: positions are only what was entered', () => {
    store().addUnit(makeUnit('ai1', { side: 'ai', position: { x: 0, y: 0 } }))
    store().addUnit(makeUnit('p1', { position: { x: 400, y: 0 } }))
    store().revealOrders()
    expect(unit('ai1').aiOrder).not.toBeNull()
    store().nextTurn()
    expect(unit('ai1').position).toEqual({ x: 0, y: 0 })
    expect(unit('ai1').orientation).toBe(8)
  })
})

describe('gameStore — the turn', () => {
  beforeEach(() => {
    fresh()
    // Wind from the north; both ships head east, reaching, the player 400mm off.
    store().addUnit(makeUnit('ai1', { side: 'ai', aiStyle: 'aggressive', shipType: 'rate_3' }))
    store().addUnit(makeUnit('p1', { position: { x: 400, y: 0 } }))
  })

  it('opens describing the table, and reveals orders for every AI ship that can act', () => {
    expect(game().phase).toBe('input')
    store().addUnit(makeUnit('ai2', { side: 'ai', position: { x: 0, y: 300 }, status: 'destroyed' }))
    store().revealOrders()
    expect(game().phase).toBe('orders')
    expect(unit('ai1').aiOrder).not.toBeNull()
    expect(unit('ai1').aiOrder!.chunks).toHaveLength(5)
    expect(unit('ai2').aiOrder).toBeNull()
    expect(unit('p1').aiOrder).toBeNull()
  })

  it('remembers, on the next turn, what the AI sailed and how she lay — and nothing else', () => {
    store().revealOrders()
    const order = unit('ai1').aiOrder!
    const sailed = planSailedDistance(order)
    expect(sailed).toBeGreaterThan(0)

    store().nextTurn()
    expect(game().phase).toBe('input')
    const after = unit('ai1')
    expect(after.aiOrder).toBeNull()
    expect(after.prevMoveDistance).toBe(sailed)
    expect(after.prevAttitude).toBe('reaching')
    // The player's ship is not the AI's to remember anything about.
    expect(unit('p1').prevMoveDistance).toBeNull()
    expect(unit('p1').prevAttitude).toBeNull()
  })

  it('holds the next order to at least half of the last move', () => {
    store().revealOrders()
    const first = planSailedDistance(unit('ai1').aiOrder!)
    store().nextTurn()
    store().revealOrders()
    const second = planSailedDistance(unit('ai1').aiOrder!)
    expect(second).toBeGreaterThanOrEqual(first / 2)
  })

  it('does nothing on next turn while the orders are not revealed', () => {
    const before = game()
    store().nextTurn()
    expect(game()).toBe(before)
  })

  it('discards revealed orders when the table they were planned against changes', () => {
    const cases: (() => void)[] = [
      () => store().updateUnit('p1', { position: { x: 500, y: 0 } }),
      () => store().updateUnit('ai1', { orientation: 10 }),
      () => store().updateUnit('ai1', { aiStyle: 'defensive' }),
      () => store().setWindDirection(4),
      () => store().setWindStrength('gale'),
      () => store().addUnit(makeUnit('p2', { position: { x: -400, y: 0 } })),
      () => store().removeUnit('p1'),
      () => store().addTerrain(ISLAND),
    ]
    for (const change of cases) {
      store().revealOrders()
      expect(game().phase).toBe('orders')
      change()
      expect(game().phase).toBe('input')
      expect(unit('ai1').aiOrder).toBeNull()
      // Nothing is remembered of an order that was never carried out.
      expect(unit('ai1').prevMoveDistance).toBeNull()
    }
  })

  it('keeps revealed orders through the bookkeeping of resolving them', () => {
    store().revealOrders()
    const order = unit('ai1').aiOrder
    store().updateUnit('p1', { status: 'destroyed' })
    store().updateUnit('ai1', { status: 'immobilised' })
    expect(game().phase).toBe('orders')
    expect(unit('ai1').aiOrder).toBe(order)
  })

  it('discards the orders on a change of terrain, even by drag', () => {
    store().addTerrain(ISLAND)
    store().revealOrders()
    store().updateTerrain(game().terrain[0].id, { center: { x: 310, y: -200 } })
    expect(game().phase).toBe('input')
  })
})

describe('gameStore — tacking as the AI remembers it', () => {
  // Wind from the north; heading 6 is beating with the wind on the port bow.
  // No base is entered, so each swing pivots on the centre.
  const setUpBeatingShip = () => {
    fresh()
    store().addUnit(makeUnit('ai1', {
      side: 'ai', aiStyle: 'aggressive', orientation: 6, shipType: 'rate_1',
      baseWidth: 0, baseLength: 0, prevAttitude: 'beating',
    }))
    // An enemy the far tack would bring the broadside onto, to make the tack worth it.
    store().addUnit(makeUnit('p1', { position: { x: -90, y: 250 }, orientation: 0 }))
  }

  beforeEach(setUpBeatingShip)

  it('reads a ship whose entered heading is head to wind as in irons, with a tack to get out of it', () => {
    store().updateUnit('ai1', { orientation: 0 })
    expect(unit('ai1').attitude).toBe('in_irons')
    expect(unit('ai1').isInIrons).toBe(true)
    store().revealOrders()
    const after = unit('ai1')
    expect(after.tackDirection).not.toBeNull()
    expect(after.aiOrder!.isTack).toBe(true)
    expect(planSailedDistance(after.aiOrder!)).toBe(0)
  })

  it('keeps swinging the way it started once the heading is re-entered head to wind', () => {
    // Coming about to port from heading 6. Re-entered at 2, still in irons
    // and the wind now on the starboard bow, geometry alone would say
    // starboard; the AI remembers port.
    store().updateUnit('ai1', { orientation: 3 })
    store().revealOrders()
    store().nextTurn()
    const remembered = unit('ai1').tackDirection
    expect(remembered).not.toBeNull()
    store().updateUnit('ai1', { orientation: 31 })
    store().revealOrders()
    expect(unit('ai1').tackDirection).toBe(remembered)
    expect(unit('ai1').aiOrder!.isTack).toBe(true)
    expect(unit('ai1').aiOrder!.chunks.some((c) => c.turn?.direction === remembered)).toBe(true)
  })

  it('lets the tack go when the entered heading says she is off the wind again', () => {
    store().updateUnit('ai1', { orientation: 3 })
    store().revealOrders()
    store().nextTurn()
    expect(unit('ai1').tackDirection).not.toBeNull()
    // Beating on the far tack, as the player reads her off the table.
    store().updateUnit('ai1', { orientation: 26 })
    store().revealOrders()
    expect(unit('ai1').tackDirection).toBeNull()
    expect(unit('ai1').aiOrder!.isTack).toBeFalsy()
  })

  it('records a drifting turn as no distance sailed', () => {
    store().updateUnit('ai1', { orientation: 0 })
    store().revealOrders()
    store().nextTurn()
    expect(unit('ai1').prevMoveDistance).toBe(0)
    expect(unit('ai1').prevAttitude).toBe('in_irons')
  })
})

describe('gameStore — the weather turning', () => {
  beforeEach(() => {
    fresh()
    // Wind from the north; heading 12 is quarter reaching on the starboard tack.
    store().addUnit(makeUnit('ai1', { side: 'ai', orientation: 12, shipType: 'rate_3' }))
    store().addUnit(makeUnit('p1', { position: { x: 400, y: 0 }, orientation: 12 }))
  })

  it('re-rates every ship against the charts for the new weather', () => {
    expect(unit('ai1').speedProfile).toEqual(speedProfile('rate_3', 'moderate_breeze', '1/1200'))
    store().setWindStrength('gale')
    expect(unit('ai1').speedProfile).toEqual(speedProfile('rate_3', 'gale', '1/1200'))
    expect(unit('ai1').driftSpeed).toBe(driftSpeed('rate_3', 'gale', '1/1200'))
  })

  it('re-reads every ship\'s attitude when the wind shifts', () => {
    expect(unit('ai1').attitude).toBe('quarter_reaching')
    store().setWindDirection(12)
    expect(unit('ai1').attitude).toBe('in_irons')
    expect(unit('p1').isInIrons).toBe(true)
  })

  it('does nothing at all when the weather has not actually changed', () => {
    const before = game()
    store().setWindStrength(before.windStrength)
    store().setWindDirection(before.windDirection)
    expect(game()).toBe(before)
  })

  it('fixes the scale once a ship is on the table', () => {
    store().setScale('1/700')
    expect(game().scale).toBe('1/1200')
    fresh()
    store().setScale('1/700')
    expect(game().scale).toBe('1/700')
  })
})
