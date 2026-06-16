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
