import type { ArcSide, FiringArc, GameState, GunProfile, TableTerrain, TerrainShape } from '../types'
import { normaliseSpeedMultiplier, tackTurnDirection } from '../game/movement'

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
 * 8 — `Unit.tackDirection` added. A ship already in irons in an older save has
 *     no recorded swing direction, so one is derived from its heading.
 * 9 — reloading is tracked per arc (`lastFireChunks`) rather than per ship
 *     (`lastFireChunk`). The old value did not record which arc had fired, so
 *     it cannot be carried over; every arc starts loaded instead.
 * 10 — an arc carries a list of gun profiles with four range bands each, in
 *     place of a single `maxRange` and gun count; `Unit.speedMultiplier` added;
 *     and `speedProfile.in_irons` is pinned to 0, since a ship head to wind
 *     carries no way of her own and drifts instead.
 */
export const CURRENT_SCHEMA_VERSION = 10

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

/**
 * Turn a pre-10 arc — one range and a gun count — into the profile list that
 * replaced it. The band edges reproduce the tiers the AI used to derive from
 * `maxRange` (each band 60% of the one outside it), so a migrated ship fights
 * at the same distances she did before.
 */
function migrateFiringArc(raw: RawRecord, index: number): FiringArc {
  const side = ((raw.side as ArcSide) ?? 'starboard')
  const id = String(raw.id ?? `arc-${side}-${index}`)

  if (Array.isArray(raw.guns)) {
    return {
      id,
      side,
      guns: (raw.guns as RawRecord[]).map((g, i) => {
        const ranges = (g.ranges ?? {}) as RawRecord
        return {
          id: String(g.id ?? `${id}-gun-${i}`),
          name: String(g.name ?? 'Guns'),
          guns: Number(g.guns ?? 0),
          ranges: {
            close: Number(ranges.close ?? 0),
            medium: Number(ranges.medium ?? 0),
            long: Number(ranges.long ?? 0),
            extreme: Number(ranges.extreme ?? 0),
          },
        } satisfies GunProfile
      }),
    }
  }

  const extreme = Number(raw.maxRange ?? 300)
  const long = extreme * 0.6
  const medium = long * 0.6
  const close = medium * 0.6
  return {
    id,
    side,
    guns: [
      {
        id: `${id}-gun-0`,
        name: 'Guns',
        guns: Number(raw.weapons ?? 10),
        ranges: {
          close: Math.round(close),
          medium: Math.round(medium),
          long: Math.round(long),
          extreme: Math.round(extreme),
        },
      },
    ],
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
  const windDirection = (raw.windDirection ?? settings.windDirection ?? 0) as number

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
    // A ship already in irons in a pre-8 save has no recorded swing direction.
    // Deriving it from its heading sends it out on the tack it is nearer to,
    // which is the only sensible reading of a state the save never captured.
    tackDirection:
      (u.tackDirection as 'port' | 'starboard' | null | undefined) ??
      (u.isInIrons ? tackTurnDirection(Number(u.orientation ?? 0), windDirection) : null),
    baseWidth: u.baseWidth ?? 30,
    baseLength: u.baseLength ?? 80,
    grappledWith: u.grappledWith ?? null,
    lastFireChunks: (u.lastFireChunks ?? {}) as Partial<Record<ArcSide, number>>,
    // A fire plan from before schema 10 records no range band, and was chosen
    // against gun data that has since been reshaped — so it is stale rather
    // than merely incomplete. Dropping it costs at most one turn's declared
    // shot on a game saved mid-reveal.
    hiddenAIFirePlan:
      u.hiddenAIFirePlan && (u.hiddenAIFirePlan as RawRecord).band ? u.hiddenAIFirePlan : null,
    hiddenAIAction: u.hiddenAIAction ?? null,
    speedMultiplier: normaliseSpeedMultiplier(Number(u.speedMultiplier ?? 1)),
    // A ship in irons makes no way of her own, so there is no sailing speed to
    // quote for it — older saves may carry one, which would have the AI rate
    // being head to wind as a decent point of sail.
    speedProfile: {
      ...((u.speedProfile ?? {}) as GameState['units'][number]['speedProfile']),
      in_irons: { max: 0 },
    },
    firingArcs: ((u.firingArcs ?? []) as RawRecord[]).map(migrateFiringArc),
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
    windDirection,
    terrain,
    units,
    currentTurn: (raw.currentTurn ?? 1) as number,
    currentPhase: (raw.currentPhase ?? 'setup') as GameState['currentPhase'],
    actionLog: (raw.actionLog ?? []) as GameState['actionLog'],
  }
}
