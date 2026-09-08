import type { GameState, TableTerrain, TerrainShape } from '../types'

/**
 * Bump this whenever the persisted save shape changes, and add the
 * corresponding normalisation to `migrateSavedGame`. Saves written before
 * versioning existed have no `schemaVersion` and are treated as version 0.
 *
 * 5 — infinite table: `tableWidth`/`tableHeight`/`backgroundImage` dropped,
 *     `originId` added, and terrain moved from traced polygons to primitives.
 * 6 — `Unit.prevMoveDistance` is nullable; `null` means no movement phase has
 *     been resolved yet, which gives a half-of-maximum minimum move.
 * 7 — `Unit.foreAndAftRigged` added. Square rig is the default for the age of
 *     sail, and it is what the old single set of attitude bands described.
 */
export const CURRENT_SCHEMA_VERSION = 7

type RawRecord = Record<string, unknown>

/**
 * Convert a legacy traced polygon into the closest primitive: the axis-aligned
 * rectangle that bounds it. Vertex-level detail is not recoverable as a
 * primitive, and a bounding box is the conservative reading (terrain is an
 * obstacle, so erring larger keeps ships clear of it).
 */
function terrainFromVertices(vertices: { x: number; y: number }[]): {
  center: { x: number; y: number }
  shape: TerrainShape
} {
  if (vertices.length === 0) {
    return { center: { x: 0, y: 0 }, shape: { kind: 'circle', width: 100, height: 100, rotation: 0 } }
  }
  const xs = vertices.map((v) => v.x)
  const ys = vertices.map((v) => v.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return {
    center: { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) },
    shape: {
      kind: 'rectangle',
      width: Math.max(1, Math.round(maxX - minX)),
      height: Math.max(1, Math.round(maxY - minY)),
      rotation: 0,
    },
  }
}

function migrateTerrain(raw: RawRecord): TableTerrain {
  const type = (raw.type as TableTerrain['type']) ?? 'island'
  const id = String(raw.id ?? '')

  if (raw.shape && raw.center) {
    const shape = raw.shape as RawRecord
    return {
      id,
      type,
      center: raw.center as { x: number; y: number },
      shape: {
        kind: (shape.kind as TerrainShape['kind']) ?? 'circle',
        width: Number(shape.width ?? 100),
        height: Number(shape.height ?? 100),
        rotation: Number(shape.rotation ?? 0),
      },
    }
  }

  const { center, shape } = terrainFromVertices((raw.vertices ?? []) as { x: number; y: number }[])
  return { id, type, center, shape }
}

/**
 * Normalise a raw object parsed from localStorage (any historical shape) into a
 * current-schema `GameState`. This is the single place legacy save formats are
 * reconciled — e.g. the old `settings.*` nesting, missing per-unit fields, and
 * the pre-infinite-table model that carried table dimensions and a background
 * photo.
 */
export function migrateSavedGame(raw: RawRecord): GameState {
  const settings = (raw.settings ?? {}) as RawRecord

  const terrain = ((raw.terrain ?? []) as RawRecord[]).map(migrateTerrain)
  const units = ((raw.units ?? []) as RawRecord[]).map((u) => ({
    ...u,
    prevAttitude: u.prevAttitude ?? 'reaching',
    // `null` = no movement phase resolved yet (schema 6). Pre-6 saves stored 0
    // for both "never moved" and "genuinely didn't move", so they keep 0 rather
    // than silently gaining a half-max minimum mid-game.
    prevMoveDistance: (u.prevMoveDistance ?? null) as number | null,
    hiddenAIOrder: u.hiddenAIOrder ?? null,
    playerOrder: u.playerOrder ?? null,
    driftSpeed: u.driftSpeed ?? 10,
    foreAndAftRigged: u.foreAndAftRigged ?? false,
    baseWidth: u.baseWidth ?? 30,
    baseLength: u.baseLength ?? 80,
    grappledWith: u.grappledWith ?? null,
    lastFireChunk: u.lastFireChunk ?? null,
    hiddenAIFirePlan: u.hiddenAIFirePlan ?? null,
    hiddenAIAction: u.hiddenAIAction ?? null,
    firingArcs: ((u.firingArcs ?? []) as RawRecord[]).map((a) => ({
      id: String(a.id ?? ''),
      side: (a.side as 'bow' | 'stern' | 'port' | 'starboard') ?? 'starboard',
      maxRange: Number(a.maxRange ?? 300),
      weapons: Number(a.weapons ?? 10),
    })),
  })) as GameState['units']

  // Pre-v5 saves have no origin. World coordinates stay exactly as they were —
  // only the frame they are *reported* in changes — so adopting the first unit
  // (or, failing that, the first terrain piece) re-anchors the readouts without
  // moving anything on the table.
  const originId =
    (raw.originId as string | null | undefined) ?? units[0]?.id ?? terrain[0]?.id ?? null

  return {
    id: raw.id as string,
    name: raw.name as string,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    originId,
    windDirection: (raw.windDirection ?? settings.windDirection ?? 0) as number,
    terrain,
    units,
    currentTurn: (raw.currentTurn ?? 1) as number,
    currentPhase: (raw.currentPhase ?? 'setup') as GameState['currentPhase'],
    actionLog: (raw.actionLog ?? []) as GameState['actionLog'],
  }
}
