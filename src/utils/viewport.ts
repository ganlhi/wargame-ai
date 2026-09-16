import type { GameState } from '../types'
import type { Point } from './geometry'
import { baseCorners, terrainPolygon } from './geometry'
import { applyMovementPlan, turnOrderFor } from '../game/movement'

/**
 * Mapping between world millimetres and screen pixels: `screen = world * scale
 * + offset`. The table is infinite, so there is no fixed rectangle to frame —
 * the view either follows the content automatically (`computeViewport`) or is
 * driven by the player panning and zooming.
 */
export interface Viewport {
  scale: number
  offsetX: number
  offsetY: number
}

/** Gap left between the content and the edge of the canvas, in pixels. */
export const PADDING = 28

/**
 * `MIN_SPAN` stops a lone ship from being magnified to absurdity;
 * `CONTENT_MARGIN` keeps content clear of the very edge, in world mm.
 */
const MIN_SPAN = 800
const CONTENT_MARGIN = 150

/** Zoom limits, in screen pixels per millimetre. */
export const MIN_SCALE = 0.01
export const MAX_SCALE = 4

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/**
 * Every world point the view needs to show: ship bases, terrain outlines, and
 * any revealed AI order's track (so an order is never drawn off-screen).
 *
 * The origin needs no entry of its own — it is a point on some unit or terrain
 * piece, so that entity's own outline already covers it.
 */
export function contentPoints(game: GameState): Point[] {
  const pts: Point[] = []

  for (const t of game.terrain) {
    pts.push(...terrainPolygon(t))
  }

  for (const u of game.units) {
    if (u.baseWidth > 0 && u.baseLength > 0) {
      pts.push(...baseCorners(u.position, u.orientation, u.baseWidth, u.baseLength))
    } else {
      pts.push(u.position)
    }

    const plan = turnOrderFor(u)
    if (!plan) continue
    // The same walk that resolves the move draws it, pivots and drift included.
    const { path, poses } = applyMovementPlan(u, plan, game.windDirection)
    pts.push(...path)
    // The base at the end of the move too, so a previewed ship is never cut off.
    const end = poses[poses.length - 1]
    if (u.baseWidth > 0 && u.baseLength > 0) {
      pts.push(...baseCorners(end, end.orientation, u.baseWidth, u.baseLength))
    }
  }

  return pts
}

/** The viewport that frames everything in play, centred, at the largest fitting scale. */
export function computeViewport(game: GameState | null, w: number, h: number): Viewport {
  if (!game || w <= 0 || h <= 0) return { scale: 1, offsetX: 0, offsetY: 0 }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of contentPoints(game)) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX)) {
    minX = maxX = minY = maxY = 0
  }

  minX -= CONTENT_MARGIN
  minY -= CONTENT_MARGIN
  maxX += CONTENT_MARGIN
  maxY += CONTENT_MARGIN

  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const spanX = Math.max(maxX - minX, MIN_SPAN)
  const spanY = Math.max(maxY - minY, MIN_SPAN)

  const scale = clampScale(Math.min((w - PADDING * 2) / spanX, (h - PADDING * 2) / spanY))
  return { scale, offsetX: w / 2 - cx * scale, offsetY: h / 2 - cy * scale }
}

export function toScreen(v: Viewport, wx: number, wy: number): Point {
  return { x: wx * v.scale + v.offsetX, y: wy * v.scale + v.offsetY }
}

export function toWorld(v: Viewport, sx: number, sy: number): Point {
  return { x: (sx - v.offsetX) / v.scale, y: (sy - v.offsetY) / v.scale }
}

/** Slide the view by a screen-pixel delta, leaving the scale alone. */
export function panViewport(v: Viewport, dx: number, dy: number): Viewport {
  return { scale: v.scale, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy }
}

/**
 * Rescale about a fixed screen point, keeping whatever world position sits
 * under it pinned there — so zooming homes in on the cursor or the pinch
 * midpoint rather than the middle of the canvas.
 */
export function zoomViewport(v: Viewport, factor: number, anchorX: number, anchorY: number): Viewport {
  const scale = clampScale(v.scale * factor)
  const world = toWorld(v, anchorX, anchorY)
  return { scale, offsetX: anchorX - world.x * scale, offsetY: anchorY - world.y * scale }
}
