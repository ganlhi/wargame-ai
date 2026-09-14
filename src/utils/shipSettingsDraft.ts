import { v4 as uuid } from 'uuid'
import type { ArcSide, FiringArc, GunProfile, Scale, ShipSettings, ShipType } from '../types'
import { speedMultiplierFromPercent, speedMultiplierToPercent } from '../game/movement'
import { DEFAULT_SHIP_TYPE, gunRanges } from '../data/binder'

/**
 * A ship's settings as a form holds them: the multiplier as the whole
 * percentage that is typed, and the guns as a map by arc side so an empty arc
 * is a plain empty list rather than an absent entry.
 *
 * There is nothing here for how fast she sails or how far she shoots — those
 * come from her type, her guns' types and the game's scale and weather, and
 * the form only shows what the charts give.
 */
export interface ShipSettingsDraft {
  shipType: ShipType
  foreAndAftRigged: boolean
  baseWidth: number
  baseLength: number
  speedPercent: number
  arcGuns: Record<ArcSide, GunProfile[]>
}

/**
 * A draft from saved settings, or the defaults a brand-new ship starts with.
 * Gun ranges are read at `scale`, so a ship imported from the library is shown
 * the distances she will actually shoot at in this game.
 */
export function draftFromSettings(settings: ShipSettings | undefined, scale: Scale): ShipSettingsDraft {
  const arcGuns: Record<ArcSide, GunProfile[]> = { bow: [], stern: [], port: [], starboard: [] }
  for (const arc of settings?.firingArcs ?? []) {
    arcGuns[arc.side] = arc.guns.map((g) => ({ ...g, ranges: gunRanges(g.type, scale) }))
  }
  return {
    shipType: settings?.shipType ?? DEFAULT_SHIP_TYPE,
    foreAndAftRigged: settings?.foreAndAftRigged ?? false,
    baseWidth: settings?.baseWidth ?? 30,
    baseLength: settings?.baseLength ?? 80,
    speedPercent: speedMultiplierToPercent(settings?.speedMultiplier),
    arcGuns,
  }
}

/**
 * The arcs a ship actually carries: any side whose guns amount to nothing is
 * left out. Arc ids are kept from `existing` where the side already had one.
 */
export function firingArcsFrom(arcGuns: Record<ArcSide, GunProfile[]>, existing: FiringArc[]): FiringArc[] {
  return (Object.entries(arcGuns) as [ArcSide, GunProfile[]][])
    .filter(([, guns]) => guns.some((g) => g.guns > 0))
    .map(([side, guns]) => ({
      id: existing.find((a) => a.side === side)?.id ?? uuid(),
      side,
      guns,
    }))
}

/** Settings as stored, from what the form holds. */
export function settingsFromDraft(draft: ShipSettingsDraft, existingArcs: FiringArc[] = []): ShipSettings {
  return {
    shipType: draft.shipType,
    foreAndAftRigged: draft.foreAndAftRigged,
    speedMultiplier: speedMultiplierFromPercent(draft.speedPercent),
    baseWidth: draft.baseWidth,
    baseLength: draft.baseLength,
    firingArcs: firingArcsFrom(draft.arcGuns, existingArcs),
  }
}
