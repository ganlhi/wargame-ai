import type { GameState, TableTerrain, Unit } from '../types'
import type { Point } from './geometry'

/**
 * The table is infinite: there are no edges and no fixed frame of reference.
 * Positions are therefore stored in an arbitrary world frame (millimetres,
 * +x = East, +y = South) and always *reported* relative to the game's origin
 * entity — the first unit or terrain piece added to the game.
 *
 * Because the origin is an entity rather than a table corner, the origin's own
 * coordinates read (0, 0) forever, even once it has sailed halfway across the
 * room; everything else moves relative to it.
 *
 * Each entity has a placement reference point, which is the point these
 * relative coordinates measure to and from:
 *  - terrain: the centre of the shape;
 *  - units: the middle of the rear (stern) edge of the base, which is how a
 *    model is actually positioned against a ruler on the table.
 */

/** A relative position, in mm along each compass axis. */
export interface Offset {
  /** Positive = East of the origin, negative = West. */
  east: number
  /** Positive = South of the origin, negative = North. */
  south: number
}

/**
 * Midpoint of a ship base's rear edge — the point a model is measured from.
 * `center` is the base centre, which is what `Unit.position` stores.
 */
export function sternMidpoint(center: Point, orientation: number, baseLength: number): Point {
  const angle = (orientation * Math.PI) / 16 - Math.PI / 2
  return {
    x: center.x - Math.cos(angle) * (baseLength / 2),
    y: center.y - Math.sin(angle) * (baseLength / 2),
  }
}

/** Inverse of {@link sternMidpoint}: the base centre for a given stern midpoint. */
export function centerFromSternMidpoint(stern: Point, orientation: number, baseLength: number): Point {
  const angle = (orientation * Math.PI) / 16 - Math.PI / 2
  return {
    x: stern.x + Math.cos(angle) * (baseLength / 2),
    y: stern.y + Math.sin(angle) * (baseLength / 2),
  }
}

/** The placement reference point of a unit, in world coordinates. */
export function unitReferencePoint(u: Unit): Point {
  return sternMidpoint(u.position, u.orientation, u.baseLength)
}

/** The placement reference point of a terrain piece, in world coordinates. */
export function terrainReferencePoint(t: TableTerrain): Point {
  return t.center
}

/**
 * World position of the game's origin. Falls back to (0, 0) for an empty game
 * or a dangling `originId`, which keeps world and relative coordinates
 * identical until the first entity is placed.
 */
export function originPoint(game: Pick<GameState, 'originId' | 'units' | 'terrain'>): Point {
  if (!game.originId) return { x: 0, y: 0 }
  const unit = game.units.find((u) => u.id === game.originId)
  if (unit) return unitReferencePoint(unit)
  const terrain = game.terrain.find((t) => t.id === game.originId)
  if (terrain) return terrainReferencePoint(terrain)
  return { x: 0, y: 0 }
}

/** Name of the origin entity, for labelling the coordinate readouts. */
export function originName(game: Pick<GameState, 'originId' | 'units' | 'terrain'>): string | null {
  if (!game.originId) return null
  const unit = game.units.find((u) => u.id === game.originId)
  if (unit) return unit.name
  const terrain = game.terrain.find((t) => t.id === game.originId)
  if (terrain) return `${terrain.type} (terrain)`
  return null
}

/** Convert a world point to an offset from `origin`. */
export function toOffset(world: Point, origin: Point): Offset {
  return { east: world.x - origin.x, south: world.y - origin.y }
}

/** Convert an offset from `origin` back to a world point. */
export function fromOffset(offset: Offset, origin: Point): Point {
  return { x: origin.x + offset.east, y: origin.y + offset.south }
}

/**
 * Human-readable offset, e.g. `320mm E · 150mm S`. An axis that is within
 * `epsilon` of the origin is dropped, so the origin itself reads "origin".
 */
export function formatOffset(offset: Offset, epsilon = 0.5): string {
  const parts: string[] = []
  if (Math.abs(offset.east) >= epsilon) {
    parts.push(`${Math.round(Math.abs(offset.east))}mm ${offset.east > 0 ? 'E' : 'W'}`)
  }
  if (Math.abs(offset.south) >= epsilon) {
    parts.push(`${Math.round(Math.abs(offset.south))}mm ${offset.south > 0 ? 'S' : 'N'}`)
  }
  return parts.length > 0 ? parts.join(' · ') : 'origin'
}

/** Convenience: format a world point as an offset from the game's origin. */
export function formatWorldPoint(world: Point, game: Pick<GameState, 'originId' | 'units' | 'terrain'>): string {
  return formatOffset(toOffset(world, originPoint(game)))
}
