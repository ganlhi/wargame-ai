import { describe, it, expect } from 'vitest'
import type { ShipSettings } from '../types'
import { draftFromSettings, settingsFromDraft } from './shipSettingsDraft'

const settings: ShipSettings = {
  maxTurnPoints: 4,
  foreAndAftRigged: true,
  speedProfile: {
    in_irons: { max: 0 },
    beating: { max: 70 },
    reaching: { max: 110 },
    quarter_reaching: { max: 130 },
    running: { max: 100 },
  },
  speedMultiplier: 0.9,
  driftSpeed: 12,
  baseWidth: 25,
  baseLength: 60,
  firingArcs: [
    {
      id: 'arc-stbd',
      side: 'starboard',
      guns: [{ id: 'g', name: '18pdr', guns: 12, ranges: { close: 80, medium: 160, long: 240, extreme: 320 } }],
    },
  ],
}

describe('ship settings draft', () => {
  it('round-trips settings through the form shape, keeping arc ids that already exist', () => {
    const draft = draftFromSettings(settings)
    expect(draft.speedPercent).toBe(90)
    expect(draft.arcGuns.starboard).toHaveLength(1)
    expect(draft.arcGuns.port).toEqual([])
    expect(settingsFromDraft(draft, settings.firingArcs)).toEqual(settings)
  })

  it('starts a new ship from the defaults and leaves empty arcs out of what is stored', () => {
    const draft = draftFromSettings()
    expect(draft.speedPercent).toBe(100)
    const stored = settingsFromDraft({
      ...draft,
      arcGuns: {
        ...draft.arcGuns,
        // Guns that reach nowhere, or none at all, do not make an arc.
        bow: [{ id: 'x', name: 'Chasers', guns: 2, ranges: { close: 0, medium: 0, long: 0, extreme: 0 } }],
        port: [{ id: 'y', name: 'Empty', guns: 0, ranges: { close: 100, medium: 200, long: 300, extreme: 400 } }],
      },
    })
    expect(stored.firingArcs).toEqual([])
    expect(stored.speedMultiplier).toBe(1)
    expect(stored.speedProfile.in_irons.max).toBe(0)
  })
})
