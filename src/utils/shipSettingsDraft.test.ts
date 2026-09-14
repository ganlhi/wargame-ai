import { describe, it, expect } from 'vitest'
import type { ShipSettings } from '../types'
import { draftFromSettings, settingsFromDraft } from './shipSettingsDraft'
import { gunRanges } from '../data/binder'

const SCALE = '1/1200'

const settings: ShipSettings = {
  shipType: 'rate_5',
  foreAndAftRigged: true,
  speedMultiplier: 0.9,
  baseWidth: 25,
  baseLength: 60,
  firingArcs: [
    {
      id: 'arc-stbd',
      side: 'starboard',
      guns: [{ id: 'g', type: 'long_18', guns: 12, ranges: gunRanges('long_18', SCALE) }],
    },
  ],
}

describe('ship settings draft', () => {
  it('round-trips settings through the form shape, keeping arc ids that already exist', () => {
    const draft = draftFromSettings(settings, SCALE)
    expect(draft.speedPercent).toBe(90)
    expect(draft.arcGuns.starboard).toHaveLength(1)
    expect(draft.arcGuns.port).toEqual([])
    expect(settingsFromDraft(draft, settings.firingArcs)).toEqual(settings)
  })

  it('reads the ranges of a gun at the scale the draft is made for', () => {
    const draft = draftFromSettings(settings, '1/700')
    expect(draft.arcGuns.starboard[0].ranges).toEqual(gunRanges('long_18', '1/700'))
  })

  it('starts a new ship from the defaults and leaves gunless arcs out of what is stored', () => {
    const draft = draftFromSettings(undefined, SCALE)
    expect(draft.speedPercent).toBe(100)
    const stored = settingsFromDraft({
      ...draft,
      arcGuns: {
        ...draft.arcGuns,
        // An arc with no guns in it is not an arc.
        port: [{ id: 'y', type: 'long_9', guns: 0, ranges: gunRanges('long_9', SCALE) }],
      },
    })
    expect(stored.firingArcs).toEqual([])
    expect(stored.speedMultiplier).toBe(1)
  })
})
