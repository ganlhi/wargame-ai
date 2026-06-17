import { describe, it, expect } from 'vitest'
import { baseCorners, polygonsIntersect, polygonDistance } from './geometry'

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
