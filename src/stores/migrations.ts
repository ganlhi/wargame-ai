import type { GameState } from '../types'

/**
 * Bump this whenever the persisted save shape changes, and add the
 * corresponding normalisation to `migrateSavedGame`. Saves written before
 * versioning existed have no `schemaVersion` and are treated as version 0.
 */
export const CURRENT_SCHEMA_VERSION = 1

type RawRecord = Record<string, unknown>

/**
 * Normalise a raw object parsed from localStorage (any historical shape) into a
 * current-schema `GameState`. This is the single place legacy save formats are
 * reconciled — e.g. the old `settings.*` nesting and missing per-unit fields.
 */
export function migrateSavedGame(raw: RawRecord): GameState {
  const settings = (raw.settings ?? {}) as RawRecord

  const game: GameState = {
    id: raw.id as string,
    name: raw.name as string,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    tableWidth: (raw.tableWidth ?? settings.tableWidth ?? 1200) as number,
    tableHeight: (raw.tableHeight ?? settings.tableHeight ?? 900) as number,
    windDirection: (raw.windDirection ?? settings.windDirection ?? 0) as number,
    terrain: (raw.terrain ?? []) as GameState['terrain'],
    units: ((raw.units ?? []) as RawRecord[]).map((u) => ({
      ...u,
      prevAttitude: u.prevAttitude ?? 'reaching',
      prevMoveDistance: u.prevMoveDistance ?? 0,
      hiddenAIOrder: u.hiddenAIOrder ?? null,
      playerOrder: u.playerOrder ?? null,
      driftSpeed: u.driftSpeed ?? 10,
      lastFireChunk: u.lastFireChunk ?? null,
      hiddenAIFirePlan: u.hiddenAIFirePlan ?? null,
      firingArcs: ((u.firingArcs ?? []) as RawRecord[]).map((a) => ({
        id: String(a.id ?? ''),
        side: (a.side as 'bow' | 'stern' | 'port' | 'starboard') ?? 'starboard',
        maxRange: Number(a.maxRange ?? 300),
        weapons: Number(a.weapons ?? 10),
      })),
    })) as GameState['units'],
    currentTurn: (raw.currentTurn ?? 1) as number,
    currentPhase: (raw.currentPhase ?? 'setup') as GameState['currentPhase'],
    actionLog: (raw.actionLog ?? []) as GameState['actionLog'],
    backgroundImage: raw.backgroundImage as string | undefined,
  }

  return game
}
