import { describe, it, expect } from 'vitest'
import { dashSegments } from './dashedPath'

const length = ([a, b]: [{ x: number; y: number }, { x: number; y: number }]) =>
  Math.hypot(b.x - a.x, b.y - a.y)

const total = (segments: [{ x: number; y: number }, { x: number; y: number }][]) =>
  segments.reduce((sum, s) => sum + length(s), 0)

describe('dashSegments', () => {
  it('starts on a dash and alternates dash, gap, dash along a straight line', () => {
    // 30 long, 6 on / 4 off → dashes at 0-6, 10-16, 20-26, then 30 ends mid-gap.
    const segments = dashSegments([{ x: 0, y: 0 }, { x: 30, y: 0 }], 6, 4)
    expect(segments.map(([a, b]) => [a.x, b.x])).toEqual([
      [0, 6],
      [10, 16],
      [20, 26],
    ])
  })

  it('leaves a partial dash at the end rather than overshooting', () => {
    const segments = dashSegments([{ x: 0, y: 0 }, { x: 13, y: 0 }], 6, 4)
    expect(segments[segments.length - 1][1].x).toBe(13)
    expect(total(segments)).toBeLessThanOrEqual(13)
  })

  it('carries the pattern across a corner instead of restarting', () => {
    // 4 across then 4 down: a 6-long dash must run 4 along the first leg and
    // 2 into the second, not start afresh at the corner.
    const segments = dashSegments(
      [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }],
      6,
      4,
    )
    expect(segments[0]).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }])
    expect(segments[1]).toEqual([{ x: 4, y: 0 }, { x: 4, y: 2 }])
  })

  it('covers roughly the dash fraction of the whole path', () => {
    const segments = dashSegments([{ x: 0, y: 0 }, { x: 1000, y: 0 }], 6, 4)
    // 6 on out of every 10 → about 60% of 1000, give or take the final partial.
    expect(total(segments)).toBeGreaterThan(560)
    expect(total(segments)).toBeLessThan(620)
  })

  it('never draws outside the path it was given', () => {
    const segments = dashSegments([{ x: 0, y: 0 }, { x: 50, y: 0 }], 6, 5)
    for (const [a, b] of segments) {
      for (const p of [a, b]) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(50)
        expect(p.y).toBe(0)
      }
    }
  })

  it('skips zero-length steps, which a drifting ship produces when it holds station', () => {
    const segments = dashSegments(
      [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 12, y: 0 }],
      6,
      4,
    )
    expect(segments[0]).toEqual([{ x: 0, y: 0 }, { x: 6, y: 0 }])
  })

  it('returns nothing for a degenerate path or a nonsense pattern', () => {
    expect(dashSegments([], 6, 4)).toEqual([])
    expect(dashSegments([{ x: 0, y: 0 }], 6, 4)).toEqual([])
    expect(dashSegments([{ x: 0, y: 0 }, { x: 0, y: 0 }], 6, 4)).toEqual([])
    expect(dashSegments([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0, 4)).toEqual([])
    expect(dashSegments([{ x: 0, y: 0 }, { x: 10, y: 0 }], 6, 0)).toEqual([])
  })
})
