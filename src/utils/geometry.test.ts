import { describe, it, expect } from 'vitest'
import {
  baseCorners, polygonsIntersect, polygonDistance,
  terrainPolygon, pointInPolygon, pointPolygonEdgeDistance,
} from './geometry'
import type { TableTerrain, TerrainShapeKind } from '../types'

function terrain(kind: TerrainShapeKind, width: number, height: number, rotation = 0): TableTerrain {
  return { id: 't', type: 'island', center: { x: 0, y: 0 }, shape: { kind, width, height, rotation } }
}

describe('baseCorners', () => {
  it('builds an axis-aligned box when the bow points along +x (orientation 8)', () => {
    const corners = baseCorners({ x: 0, y: 0 }, 8, 20, 100)
    const xs = corners.map((c) => Math.round(c.x))
    const ys = corners.map((c) => Math.round(c.y))
    // length (100) along x → ±50, width (20) across y → ±10
    expect(Math.min(...xs)).toBe(-50)
    expect(Math.max(...xs)).toBe(50)
    expect(Math.min(...ys)).toBe(-10)
    expect(Math.max(...ys)).toBe(10)
  })
})

describe('polygonsIntersect', () => {
  const a = baseCorners({ x: 0, y: 0 }, 8, 20, 100)

  it('detects overlapping bases', () => {
    const b = baseCorners({ x: 40, y: 0 }, 8, 20, 100)
    expect(polygonsIntersect(a, b)).toBe(true)
  })

  it('reports no overlap when bases are clear of each other', () => {
    const b = baseCorners({ x: 200, y: 0 }, 8, 20, 100)
    expect(polygonsIntersect(a, b)).toBe(false)
  })

  it('detects overlap that only shows up on a rotated edge axis', () => {
    // A box rotated 45°-ish nestled near the corner of the first.
    const b = baseCorners({ x: 55, y: 12 }, 4, 20, 100)
    expect(polygonsIntersect(a, b)).toBe(true)
  })
})

describe('polygonDistance', () => {
  it('returns 0 for overlapping polygons', () => {
    const a = baseCorners({ x: 0, y: 0 }, 8, 20, 100)
    const b = baseCorners({ x: 40, y: 0 }, 8, 20, 100)
    expect(polygonDistance(a, b)).toBe(0)
  })

  it('measures the gap between separated polygons', () => {
    // Two 100-long boxes along x at centres 0 and 160 → edges at 50 and 110 → 60 gap.
    const a = baseCorners({ x: 0, y: 0 }, 8, 20, 100)
    const b = baseCorners({ x: 160, y: 0 }, 8, 20, 100)
    expect(polygonDistance(a, b)).toBeCloseTo(60, 5)
  })
})

describe('terrainPolygon', () => {
  it('turns a rectangle into its four corners', () => {
    const poly = terrainPolygon(terrain('rectangle', 200, 100))
    expect(poly).toHaveLength(4)
    expect(Math.min(...poly.map((p) => p.x))).toBe(-100)
    expect(Math.max(...poly.map((p) => p.x))).toBe(100)
    expect(Math.min(...poly.map((p) => p.y))).toBe(-50)
    expect(Math.max(...poly.map((p) => p.y))).toBe(50)
  })

  it('rotates a rectangle clockwise by compass points', () => {
    // 8 points = 90° clockwise, so the E–W width becomes the N–S extent.
    const poly = terrainPolygon(terrain('rectangle', 200, 100, 8))
    expect(Math.round(Math.max(...poly.map((p) => p.x)))).toBe(50)
    expect(Math.round(Math.max(...poly.map((p) => p.y)))).toBe(100)
  })

  it('approximates a circle using the width as its diameter, ignoring height', () => {
    const poly = terrainPolygon(terrain('circle', 200, 9999))
    for (const p of poly) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(100, 6)
    }
  })

  it('gives an ellipse different semi-axes', () => {
    const poly = terrainPolygon(terrain('ellipse', 400, 100))
    expect(Math.round(Math.max(...poly.map((p) => p.x)))).toBe(200)
    expect(Math.round(Math.max(...poly.map((p) => p.y)))).toBe(50)
  })
})

describe('pointInPolygon / pointPolygonEdgeDistance', () => {
  const island = terrainPolygon(terrain('rectangle', 200, 100))

  it('detects containment', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, island)).toBe(true)
    expect(pointInPolygon({ x: 150, y: 0 }, island)).toBe(false)
  })

  it('measures the distance to the nearest edge from inside and outside', () => {
    // Inside: nearest edge is the top/bottom at y = ±50.
    expect(pointPolygonEdgeDistance({ x: 0, y: 0 }, island)).toBeCloseTo(50, 6)
    // Outside: 50mm east of the x = 100 edge.
    expect(pointPolygonEdgeDistance({ x: 150, y: 0 }, island)).toBeCloseTo(50, 6)
  })
})
