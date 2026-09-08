import { describe, it, expect } from 'vitest'
import {
  MAX_SCALE, MIN_SCALE, computeViewport, panViewport, toScreen, toWorld, zoomViewport,
} from './viewport'
import type { GameState, Unit } from '../types'

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'u1', name: 'Test', side: 'player',
    position: { x: 0, y: 0 }, orientation: 0, status: 'active', aiStyle: 'cautious',
    maxTurnPoints: 6,
    foreAndAftRigged: false,
    speedProfile: {
      in_irons: { max: 0 }, beating: { max: 60 }, reaching: { max: 80 },
      quarter_reaching: { max: 100 }, running: { max: 90 },
    },
    driftSpeed: 10, baseWidth: 30, baseLength: 80, firingArcs: [],
    attitude: 'reaching', isInIrons: false, grappledWith: null,
    prevAttitude: 'reaching', prevMoveDistance: null,
    hiddenAIOrder: null, playerOrder: null, lastFireChunk: null,
    hiddenAIFirePlan: null, hiddenAIAction: null,
    ...overrides,
  }
}

function makeGame(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'g1', name: 'Test', createdAt: '', updatedAt: '', schemaVersion: 6,
    originId: null, windDirection: 0, terrain: [], units: [],
    currentTurn: 1, currentPhase: 'setup', actionLog: [],
    ...overrides,
  }
}

const VIEW = { scale: 0.5, offsetX: 100, offsetY: 40 }

describe('toScreen / toWorld', () => {
  it('are inverses', () => {
    const world = { x: -321, y: 987 }
    const screen = toScreen(VIEW, world.x, world.y)
    const back = toWorld(VIEW, screen.x, screen.y)
    expect(back.x).toBeCloseTo(world.x, 9)
    expect(back.y).toBeCloseTo(world.y, 9)
  })
})

describe('panViewport', () => {
  it('slides by screen pixels and leaves the scale alone', () => {
    const panned = panViewport(VIEW, 30, -12)
    expect(panned).toEqual({ scale: 0.5, offsetX: 130, offsetY: 28 })
  })

  it('moves the world under a fixed screen point by the inverse delta', () => {
    const before = toWorld(VIEW, 200, 200)
    const after = toWorld(panViewport(VIEW, 50, 0), 200, 200)
    expect(after.x).toBeCloseTo(before.x - 50 / VIEW.scale, 9)
  })
})

describe('zoomViewport', () => {
  it('pins the world point under the anchor', () => {
    for (const factor of [0.25, 0.9, 1, 1.5, 4]) {
      const anchor = { x: 317, y: 88 }
      const worldBefore = toWorld(VIEW, anchor.x, anchor.y)
      const zoomed = zoomViewport(VIEW, factor, anchor.x, anchor.y)
      const worldAfter = toWorld(zoomed, anchor.x, anchor.y)
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6)
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6)
    }
  })

  it('scales by the factor', () => {
    expect(zoomViewport(VIEW, 2, 0, 0).scale).toBeCloseTo(1, 9)
  })

  it('clamps at both ends, and still keeps the anchor pinned when clamped', () => {
    expect(zoomViewport(VIEW, 1e6, 10, 10).scale).toBe(MAX_SCALE)
    expect(zoomViewport(VIEW, 1e-6, 10, 10).scale).toBe(MIN_SCALE)

    const worldBefore = toWorld(VIEW, 10, 10)
    const worldAfter = toWorld(zoomViewport(VIEW, 1e6, 10, 10), 10, 10)
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6)
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6)
  })
})

describe('computeViewport', () => {
  it('centres a single ship without magnifying it absurdly', () => {
    const game = makeGame({ units: [makeUnit({ position: { x: 5000, y: -3000 } })] })
    const v = computeViewport(game, 800, 600)
    const centre = toScreen(v, 5000, -3000)
    expect(centre.x).toBeCloseTo(400, 6)
    expect(centre.y).toBeCloseTo(300, 6)
    // MIN_SPAN is 800mm, so a lone 80mm ship must not fill the canvas.
    expect(v.scale).toBeLessThanOrEqual((600 - 28 * 2) / 800 + 1e-9)
  })

  it('fits two distant ships inside the canvas', () => {
    const game = makeGame({
      units: [
        makeUnit({ id: 'a', position: { x: 0, y: 0 } }),
        makeUnit({ id: 'b', position: { x: 4000, y: 2000 } }),
      ],
    })
    const v = computeViewport(game, 800, 600)
    for (const p of [toScreen(v, 0, 0), toScreen(v, 4000, 2000)]) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(800)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(600)
    }
  })

  it('follows the content as it spreads out', () => {
    const near = computeViewport(
      makeGame({ units: [makeUnit({ id: 'a' }), makeUnit({ id: 'b', position: { x: 500, y: 0 } })] }),
      800, 600,
    )
    const far = computeViewport(
      makeGame({ units: [makeUnit({ id: 'a' }), makeUnit({ id: 'b', position: { x: 8000, y: 0 } })] }),
      800, 600,
    )
    expect(far.scale).toBeLessThan(near.scale)
  })

  it('survives an empty game and a zero-sized canvas', () => {
    expect(computeViewport(makeGame(), 800, 600).scale).toBeGreaterThan(0)
    expect(computeViewport(makeGame(), 0, 0)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 })
    expect(computeViewport(null, 800, 600)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 })
  })
})
