import type { GameState, TableTerrain, Unit } from '../types'
import type { Point } from './geometry'

/**
 * The table is infinite: there are no edges and no fixed frame of reference.
 * Positions are therefore stored in an arbitrary world frame (millimetres,
 * +x = East, +y = South) and always *entered and shown* as a bearing from the
 * game's origin ship — the first ship placed — the way a player reads a
 * position across the table: so many millimetres in such a direction.
 *
 * Each entity has a reference point the bearing is measured to:
 *  - ships: the centre of the base (what `Unit.position` holds);
 *  - terrain: the centre of its bounding box, which for the primitives the
 *    app uses is the centre of the shape (`TableTerrain.center`).
 */

/**
 * The 16 points of the compass rose, clockwise from north. Positions are read
 * on this coarser rose rather than the 32-point one headings use: a bearing
 * eyeballed across a table is not accurate to a degree, and NNW is what a
 * player says.
 */
export const COMPASS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const

export const BEARING_POINTS = COMPASS_16.length

/** A position relative to the origin ship: which way and how far. */
export interface Bearing {
  /** Index into {@link COMPASS_16}: 0 = N, 4 = E, 8 = S, 12 = W. */
  direction: number
  /** Distance in mm; 0 is the origin itself. */
  distance: number
}

/** Angle of a rose point clockwise from north, in radians. */
function directionAngle(direction: number): number {
  return (direction * 2 * Math.PI) / BEARING_POINTS
}

/** The placement reference point of a unit, in world coordinates. */
export function unitReferencePoint(u: Unit): Point {
  return u.position
}

/**
 * Midpoint of a ship base's rear edge. Positions are measured to the base
 * centre, but a model is walked along the table by its stern, so that is the
 * point a planned track is drawn through.
 */
export function sternMidpoint(center: Point, orientation: number, baseLength: number): Point {
  const angle = (orientation * Math.PI) / 16 - Math.PI / 2
  return {
    x: center.x - Math.cos(angle) * (baseLength / 2),
    y: center.y - Math.sin(angle) * (baseLength / 2),
  }
}

/** The placement reference point of a terrain piece, in world coordinates. */
export function terrainReferencePoint(t: TableTerrain): Point {
  return t.center
}

/**
 * World position of the game's origin ship. Falls back to (0, 0) for a game
 * with no ships or a dangling `originId`, which keeps world and relative
 * coordinates identical until the first ship is placed.
 */
export function originPoint(game: Pick<GameState, 'originId' | 'units'>): Point {
  if (!game.originId) return { x: 0, y: 0 }
  const unit = game.units.find((u) => u.id === game.originId)
  return unit ? unitReferencePoint(unit) : { x: 0, y: 0 }
}

/** Name of the origin ship, for labelling the readouts. */
export function originName(game: Pick<GameState, 'originId' | 'units'>): string | null {
  if (!game.originId) return null
  return game.units.find((u) => u.id === game.originId)?.name ?? null
}

/**
 * The bearing of a world point from `origin`: the nearest of the 16 points,
 * and the distance to the nearest millimetre. A point on the origin has no
 * direction to speak of and reads north at 0 mm.
 */
export function toBearing(world: Point, origin: Point): Bearing {
  const dx = world.x - origin.x
  const dy = world.y - origin.y
  const distance = Math.round(Math.hypot(dx, dy))
  if (distance === 0) return { direction: 0, distance: 0 }
  // Clockwise from north: north is -y, east is +x.
  const angle = Math.atan2(dx, -dy)
  const direction =
    (Math.round((angle / (2 * Math.PI)) * BEARING_POINTS) + BEARING_POINTS) % BEARING_POINTS
  return { direction, distance }
}

/** The world point a bearing from `origin` names. */
export function fromBearing(bearing: Bearing, origin: Point): Point {
  const angle = directionAngle(bearing.direction)
  return {
    x: origin.x + Math.sin(angle) * bearing.distance,
    y: origin.y - Math.cos(angle) * bearing.distance,
  }
}

/** Human-readable bearing, e.g. `420 mm NNW`; the origin itself reads `origin`. */
export function formatBearing(bearing: Bearing): string {
  if (Math.round(bearing.distance) === 0) return 'origin'
  return `${Math.round(bearing.distance)} mm ${COMPASS_16[bearing.direction]}`
}

/** Convenience: a world point as a bearing from the game's origin ship. */
export function formatWorldPoint(world: Point, game: Pick<GameState, 'originId' | 'units'>): string {
  return formatBearing(toBearing(world, originPoint(game)))
}

/**
 * Where one point lies from another, as a bearing — `ends 182 mm NNE of her
 * start`. Used for readings that must not depend on the origin ship, which may
 * itself have moved.
 */
export function formatDisplacement(from: Point, to: Point): string {
  const bearing = toBearing(to, from)
  return bearing.distance === 0 ? 'where she started' : `${formatBearing(bearing)} of her start`
}
