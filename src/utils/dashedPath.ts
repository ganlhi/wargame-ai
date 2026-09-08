import type { Point } from './geometry'

/**
 * Split a polyline into the drawn stretches of a dashed line.
 *
 * PixiJS strokes are solid, so a dashed path has to be walked out by hand. The
 * remainder of a dash carries across segment boundaries rather than restarting
 * at each corner, so the pattern stays even along a path that bends — which a
 * drift track does, every time the ship swings.
 *
 * Lengths are in the same units as the points, i.e. screen pixels.
 */
export function dashSegments(
  points: Point[],
  dash: number,
  gap: number,
): [Point, Point][] {
  const out: [Point, Point][] = []
  if (points.length < 2 || dash <= 0 || gap <= 0) return out

  let penDown = true
  let remaining = dash

  for (let i = 1; i < points.length; i++) {
    let from = points[i - 1]
    const to = points[i]
    let left = Math.hypot(to.x - from.x, to.y - from.y)
    if (left === 0) continue

    const ux = (to.x - from.x) / left
    const uy = (to.y - from.y) / left

    while (left > 1e-9) {
      const step = Math.min(remaining, left)
      const next = { x: from.x + ux * step, y: from.y + uy * step }
      if (penDown) out.push([from, next])

      from = next
      left -= step
      remaining -= step

      if (remaining <= 1e-9) {
        penDown = !penDown
        remaining = penDown ? dash : gap
      }
    }
  }

  return out
}
