import type {
  ArcSide, FiringArc, GameState, GunProfile, GunType, Scale, ShipTemplate, ShipType,
  TableTerrain, TerrainShape, WindStrength,
} from '../types'
import { GUN_TYPES, SCALES, SHIP_TYPES, WIND_STRENGTHS } from '../types'
import { normaliseSpeedMultiplier, tackTurnDirection } from '../game/movement'
import {
  DEFAULT_SHIP_TYPE, REFERENCE_SCALE, gunRanges, nearestGunType, nearestShipType,
} from '../data/binder'
import { shipStats } from '../game/shipStats'

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
 * 11 — speeds and gun ranges come from the rulebook's charts instead of being
 *     typed in: a game carries a `scale` and a `windStrength`, a unit a
 *     `shipType`, and a gun profile a `type`. Older saves hold the numbers but
 *     not what they describe, so each ship and each gun is matched to the
 *     closest entry in the charts — which keeps her sailing and shooting at
 *     about the distances she was given — and everything is re-read from
 *     there. The scale and weather a pre-11 save was played at were never
 *     recorded, so it is read as 1/1200 in a moderate breeze.
 */
export const CURRENT_SCHEMA_VERSION = 11

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

/** One of the values the union allows, or the fallback. */
function oneOf<T extends string>(allowed: readonly T[], raw: unknown, fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback
}

/**
 * Normalise an arc to the current shape: a list of gun profiles, each a type
 * from the charts and a number of guns, with the band edges read back from the
 * charts at the game's scale.
 *
 * Two older shapes come through here. Pre-10 arcs carried a single `maxRange`
 * and gun count; pre-11 ones carried typed-in band edges. Neither records
 * *which* gun it was, so the closest gun in the charts is taken, leaving the
 * ship shooting about as far as she did before.
 */
function migrateFiringArc(raw: RawRecord, index: number, scale: Scale): FiringArc {
  const side = ((raw.side as ArcSide) ?? 'starboard')
  const id = String(raw.id ?? `arc-${side}-${index}`)

  const profile = (g: RawRecord, i: number, guns: number, extreme: number): GunProfile => {
    const type: GunType = GUN_TYPES.includes(g.type as GunType)
      ? (g.type as GunType)
      : nearestGunType(extreme, scale)
    return { id: String(g.id ?? `${id}-gun-${i}`), type, guns, ranges: gunRanges(type, scale) }
  }

  if (Array.isArray(raw.guns)) {
    return {
      id,
      side,
      guns: (raw.guns as RawRecord[]).map((g, i) =>
        profile(g, i, Number(g.guns ?? 0), Number(((g.ranges ?? {}) as RawRecord).extreme ?? 0)),
      ),
    }
  }

  return {
    id,
    side,
    guns: [profile({}, 0, Number(raw.weapons ?? 10), Number(raw.maxRange ?? 300))],
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
 * The ship type a raw record describes: the one it names if it names one, or
 * else the closest match to the speed and turning it was given before types
 * existed. `wind` and `scale` are the conditions those figures are read as
 * having been quoted under.
 */
function shipTypeOf(raw: RawRecord, wind: WindStrength, scale: Scale): ShipType {
  if (SHIP_TYPES.includes(raw.shipType as ShipType)) return raw.shipType as ShipType
  const profile = (raw.speedProfile ?? {}) as Record<string, { max?: number } | undefined>
  const best = Number(profile.quarter_reaching?.max ?? 0)
  if (!best) return DEFAULT_SHIP_TYPE
  return nearestShipType(best, Number(raw.maxTurnPoints ?? 6), wind, scale)
}

/**
 * A saved ship template from storage or Drive, with the same defaults a unit
 * gets, or null when the object is not a template at all. Templates are
 * written by the same build that reads them far more often than games are
 * carried across versions, so they get the unit's field defaults rather than a
 * schema history of their own.
 *
 * A saved ship holds no speeds or ranges of her own — those belong to the game
 * she is fought in — so her guns' band edges are simply held at
 * {@link REFERENCE_SCALE} and re-read wherever she is imported.
 */
export function normaliseShipTemplate(raw: unknown): ShipTemplate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const t = raw as RawRecord
  if (typeof t.id !== 'string' || typeof t.name !== 'string' || !t.name.trim()) return null
  const timestamp = typeof t.updatedAt === 'string' ? t.updatedAt : new Date(0).toISOString()
  return {
    id: t.id,
    name: t.name,
    createdAt: typeof t.createdAt === 'string' ? t.createdAt : timestamp,
    updatedAt: timestamp,
    shipType: shipTypeOf(t, 'moderate_breeze', REFERENCE_SCALE),
    foreAndAftRigged: Boolean(t.foreAndAftRigged ?? false),
    speedMultiplier: normaliseSpeedMultiplier(Number(t.speedMultiplier ?? 1)),
    baseWidth: Number(t.baseWidth ?? 30),
    baseLength: Number(t.baseLength ?? 80),
    firingArcs: ((Array.isArray(t.firingArcs) ? t.firingArcs : []) as RawRecord[]).map((arc, i) =>
      migrateFiringArc(arc, i, REFERENCE_SCALE),
    ),
  }
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
  // Neither was recorded before schema 11. A save from then holds speeds and
  // ranges that were typed in rather than read off a chart, so what they are
  // matched against has to be assumed; 1/1200 in a moderate breeze is the
  // middle of the charts and so the least distorting reading.
  const scale = oneOf(SCALES, raw.scale, '1/1200')
  const windStrength = oneOf(WIND_STRENGTHS, raw.windStrength, 'moderate_breeze')

  const terrain = ((raw.terrain ?? []) as RawRecord[]).map(migrateTerrain)
  const units = ((raw.units ?? []) as RawRecord[]).map((u) => {
    const shipType = shipTypeOf(u, windStrength, scale)
    return {
      ...u,
      prevAttitude: u.prevAttitude ?? 'reaching',
      // `null` = no movement phase resolved yet (schema 6). Pre-6 saves stored 0
      // for both "never moved" and "genuinely didn't move", so they keep 0 rather
      // than silently gaining a half-max minimum mid-game.
      prevMoveDistance: (u.prevMoveDistance ?? null) as number | null,
      hiddenAIOrder: u.hiddenAIOrder ?? null,
      playerOrder: u.playerOrder ?? null,
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
      // Speeds, drift and turning are the charts' to give, so whatever the save
      // holds for them is thrown away and read back from the ship's type.
      shipType,
      ...shipStats(shipType, { scale, windStrength }),
      firingArcs: ((u.firingArcs ?? []) as RawRecord[]).map((arc, i) =>
        migrateFiringArc(arc, i, scale),
      ),
    }
  }) as GameState['units']

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
    windStrength,
    scale,
    terrain,
    units,
    currentTurn: (raw.currentTurn ?? 1) as number,
    currentPhase: (raw.currentPhase ?? 'setup') as GameState['currentPhase'],
    actionLog: (raw.actionLog ?? []) as GameState['actionLog'],
  }
}
