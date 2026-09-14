import { describe, it, expect } from 'vitest'
import { migrateSavedGame, CURRENT_SCHEMA_VERSION } from './migrations'
import {
  driftSpeed, gunRanges, nearestGunType, nearestShipType, speedProfile, turnPoints,
} from '../data/binder'

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

  it('gives every ship a speed multiplier of 1', () => {
    expect(game.units.every((u) => u.speedMultiplier === 1)).toBe(true)
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

describe('migrateSavedGame — guns and speed', () => {
  /** A pre-10 save: arcs with one range and a gun count, and a sailing speed
   *  quoted for a ship in irons. */
  const preGunProfiles = {
    ...legacySave,
    schemaVersion: 9,
    units: [
      {
        id: 'u1',
        name: 'Victory',
        side: 'ai',
        position: { x: 0, y: 0 },
        orientation: 0,
        speedMultiplier: 1.25,
        speedProfile: {
          in_irons: { max: 40 },
          beating: { max: 60 },
          reaching: { max: 80 },
          quarter_reaching: { max: 100 },
          running: { max: 90 },
        },
        firingArcs: [{ id: 'a1', side: 'starboard', maxRange: 300, weapons: 12 }],
        hiddenAIFirePlan: { targetId: 'u2', chunkIndex: 1, arcSide: 'starboard' },
      },
    ],
  }

  const game = migrateSavedGame({ ...preGunProfiles })
  const unit = game.units[0]

  it('turns a single range and gun count into the gun that reaches about as far', () => {
    expect(unit.firingArcs).toHaveLength(1)
    const [profile] = unit.firingArcs[0].guns
    expect(profile.guns).toBe(12)
    // A pre-charts arc records how far it carried but not what it was, so it
    // takes the gun whose reach is nearest and the bands that come with it.
    expect(profile.type).toBe(nearestGunType(300, '1/1200'))
    expect(profile.ranges).toEqual(gunRanges(profile.type, '1/1200'))
  })

  it('keeps a multiplier the save already carried, full sail included', () => {
    expect(unit.speedMultiplier).toBe(1.25)
  })

  it('falls back to 1 for a save written before multipliers existed', () => {
    const older = migrateSavedGame({
      ...preGunProfiles,
      units: [{ ...preGunProfiles.units[0], speedMultiplier: undefined }],
    })
    expect(older.units[0].speedMultiplier).toBe(1)
  })

  it('reads speeds, drift and turning back off the charts for the ship it matched', () => {
    // Nothing typed in survives: the save is read as 1/1200 in a moderate
    // breeze, and everything about how she sails follows from her type.
    expect(unit.shipType).toBe(nearestShipType(100, 6, 'moderate_breeze', '1/1200'))
    expect(unit.speedProfile).toEqual(speedProfile(unit.shipType, 'moderate_breeze', '1/1200'))
    expect(unit.speedProfile.in_irons).toEqual({ max: 0 })
    expect(unit.driftSpeed).toBe(driftSpeed(unit.shipType, 'moderate_breeze', '1/1200'))
    expect(unit.maxTurnPoints).toBe(turnPoints(unit.shipType))
  })

  it('drops a fire plan chosen against the old gun data', () => {
    expect(unit.hiddenAIFirePlan).toBeNull()
  })

  it('keeps the gun count of an arc that already held profiles, re-reading its ranges', () => {
    const current = migrateSavedGame({
      ...preGunProfiles,
      schemaVersion: 10,
      units: [
        {
          ...preGunProfiles.units[0],
          firingArcs: [
            {
              id: 'a1',
              side: 'port',
              guns: [
                {
                  id: 'g1',
                  name: 'Carronade',
                  guns: 6,
                  ranges: { close: 40, medium: 80, long: 120, extreme: 150 },
                },
              ],
            },
          ],
          hiddenAIFirePlan: {
            targetId: 'u2', chunkIndex: 1, arcSide: 'port', band: 'medium', effectiveGuns: 3.24,
          },
        },
      ],
    })
    const type = nearestGunType(150, '1/1200')
    expect(current.units[0].firingArcs[0].guns[0]).toEqual({
      id: 'g1',
      type,
      guns: 6,
      ranges: gunRanges(type, '1/1200'),
    })
    expect(current.units[0].hiddenAIFirePlan?.band).toBe('medium')
  })
})
