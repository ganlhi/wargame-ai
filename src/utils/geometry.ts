import { arcSideToAngles } from '../types'

export interface Point {
  x: number
  y: number
}

export function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

/**
 * Ship orientation is a 32-point compass value (0 = bow pointing "up"/north).
 * Convert it to a heading in degrees in the same frame as `angleBetweenPoints`.
 */
export function headingDeg(orientation: number): number {
  return ((orientation * 360 / 32) + 270) % 360
}

/** Absolute angle (degrees, 0–360) of the vector from `from` to `to`. */
export function angleBetweenPoints(from: Point, to: Point): number {
  return ((Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI) + 360) % 360
}

/** Angle of `toAngleDeg` relative to a heading, normalised to 0–360. */
export function relativeAngle(fromHeadingDeg: number, toAngleDeg: number): number {
  return ((toAngleDeg - fromHeadingDeg) + 360) % 360
}

/** Whether `angle` falls within an arc, handling arcs that wrap past 360. */
export function inArc(angle: number, minAngle: number, maxAngle: number): boolean {
  if (minAngle <= maxAngle) {
    return angle >= minAngle && angle <= maxAngle
  }
  return angle >= minAngle || angle <= maxAngle
}

/**
 * True when a target presents its bow or stern to the firer, i.e. the firer
 * can rake it. `targetRelAngle` is the bearing of the firer relative to the
 * target's heading. The bow/stern arc definitions are reused from
 * `arcSideToAngles` so the angles live in exactly one place.
 */
export function isRakingAngle(targetRelAngle: number): boolean {
  const bow = arcSideToAngles('bow')
  const stern = arcSideToAngles('stern')
  return (
    inArc(targetRelAngle, bow.minAngle, bow.maxAngle) ||
    inArc(targetRelAngle, stern.minAngle, stern.maxAngle)
  )
}

/**
 * The four corners of a ship's rectangular base, in table coordinates.
 * `length` runs along the bow–stern axis, `width` across it. `orientation` is a
 * 32-point compass value (0 = bow pointing "up"), matching `orientationToVector`.
 */
export function baseCorners(
  center: Point,
  orientation: number,
  width: number,
  length: number,
): [Point, Point, Point, Point] {
  const angle = (orientation * Math.PI) / 16 - Math.PI / 2
  // Forward (bow) unit vector and the perpendicular (starboard) unit vector.
  const fx = Math.cos(angle)
  const fy = Math.sin(angle)
  const rx = -fy
  const ry = fx
  const hl = length / 2
  const hw = width / 2
  return [
    { x: center.x + fx * hl + rx * hw, y: center.y + fy * hl + ry * hw },
    { x: center.x + fx * hl - rx * hw, y: center.y + fy * hl - ry * hw },
    { x: center.x - fx * hl - rx * hw, y: center.y - fy * hl - ry * hw },
    { x: center.x - fx * hl + rx * hw, y: center.y - fy * hl + ry * hw },
  ]
}

/**
 * Separating Axis Theorem test for two convex polygons (here, ship-base
 * rectangles). Returns true if they overlap. Touching edges count as
 * overlapping, which is what we want for "bases must not intersect".
 */
export function polygonsIntersect(a: Point[], b: Point[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length
      // Outward normal of edge i→j.
      const axisX = -(poly[j].y - poly[i].y)
      const axisY = poly[j].x - poly[i].x

      let minA = Infinity, maxA = -Infinity
      for (const p of a) {
        const proj = p.x * axisX + p.y * axisY
        if (proj < minA) minA = proj
        if (proj > maxA) maxA = proj
      }
      let minB = Infinity, maxB = -Infinity
      for (const p of b) {
        const proj = p.x * axisX + p.y * axisY
        if (proj < minB) minB = proj
        if (proj > maxB) maxB = proj
      }

      if (maxA < minB || maxB < minA) return false
    }
  }
  return true
}

/** Shortest distance from point `p` to the segment `a`–`b`. */
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return distance(p, a)
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2
  t = Math.max(0, Math.min(1, t))
  return distance(p, { x: a.x + t * abx, y: a.y + t * aby })
}

/**
 * Shortest distance between two convex polygons (0 if they overlap). Computed as
 * the min over every vertex-to-edge pair in both directions, which is exact for
 * convex shapes — used to measure the gap between two ship bases.
 */
export function polygonDistance(a: Point[], b: Point[]): number {
  if (polygonsIntersect(a, b)) return 0
  let min = Infinity
  const vertexToEdges = (verts: Point[], poly: Point[]) => {
    for (const p of verts) {
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length
        const d = pointSegmentDistance(p, poly[i], poly[j])
        if (d < min) min = d
      }
    }
  }
  vertexToEdges(a, b)
  vertexToEdges(b, a)
  return min
}
