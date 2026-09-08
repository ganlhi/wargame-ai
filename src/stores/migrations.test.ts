import { describe, it, expect } from 'vitest'
import { migrateSavedGame, CURRENT_SCHEMA_VERSION } from './migrations'

/** A pre-infinite-table save: bounded table, background photo, traced terrain. */
const legacySave = {
  id: 'g1',
  name: 'Trafalgar',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  schemaVersion: 4,
  tableWidth: 1200,
  tableHeight: 900,
  backgroundImage: 'data:image/png;base64,AAAA',
  windDirection: 8,
  terrain: [
    {
      id: 't1',
      type: 'island',
      vertices: [
        { x: 100, y: 200 },
        { x: 300, y: 200 },
        { x: 300, y: 260 },
        { x: 100, y: 260 },
      ],
    },
  ],
  units: [
    { id: 'u1', name: 'Victory', side: 'player', position: { x: 400, y: 500 }, orientation: 0 },
    { id: 'u2', name: 'Bucentaure', side: 'ai', position: { x: 700, y: 500 }, orientation: 16 },
  ],
  currentTurn: 3,
  currentPhase: 'orders',
  actionLog: [],
}

describe('migrateSavedGame — infinite table', () => {
  const game = migrateSavedGame({ ...legacySave })

  it('stamps the current schema version', () => {
    expect(game.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('drops the table dimensions and the background photo', () => {
    expect('tableWidth' in game).toBe(false)
    expect('tableHeight' in game).toBe(false)
    expect('backgroundImage' in game).toBe(false)
  })

  it('adopts the first unit as the origin', () => {
    expect(game.originId).toBe('u1')
  })

  it('leaves world coordinates untouched, so nothing moves on the table', () => {
    expect(game.units[0].position).toEqual({ x: 400, y: 500 })
    expect(game.units[1].position).toEqual({ x: 700, y: 500 })
  })

  it('converts a traced polygon into its bounding rectangle', () => {
    expect(game.terrain[0].center).toEqual({ x: 200, y: 230 })
    expect(game.terrain[0].shape).toEqual({
      kind: 'rectangle',
      width: 200,
      height: 60,
      rotation: 0,
    })
  })

  it('falls back to the first terrain piece when a save has no units', () => {
    const noUnits = migrateSavedGame({ ...legacySave, units: [] })
    expect(noUnits.originId).toBe('t1')
  })

  it('leaves an empty save without an origin', () => {
    const empty = migrateSavedGame({ ...legacySave, units: [], terrain: [] })
    expect(empty.originId).toBeNull()
  })

  it('preserves an origin and primitive terrain already on the current schema', () => {
    const current = migrateSavedGame({
      ...legacySave,
      schemaVersion: 5,
      originId: 'u2',
      terrain: [
        {
          id: 't1',
          type: 'reef',
          center: { x: -50, y: 75 },
          shape: { kind: 'ellipse', width: 300, height: 120, rotation: 4 },
        },
      ],
    })
    expect(current.originId).toBe('u2')
    expect(current.terrain[0].center).toEqual({ x: -50, y: 75 })
    expect(current.terrain[0].shape).toEqual({
      kind: 'ellipse',
      width: 300,
      height: 120,
      rotation: 4,
    })
  })
})
