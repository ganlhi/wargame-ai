import { v4 as uuid } from 'uuid'
import type { ArcSide, Attitude, FiringArc, GunProfile, ShipSettings, SpeedRange } from '../types'
import { speedMultiplierFromPercent, speedMultiplierToPercent } from '../game/movement'

/**
 * A ship's settings as a form holds them: the multiplier as the whole
 * percentage that is typed, and the guns as a map by arc side so an empty arc
 * is a plain empty list rather than an absent entry.
 */
export interface ShipSettingsDraft {
  maxTurnPoints: number
  foreAndAftRigged: boolean
  baseWidth: number
  baseLength: number
  speedProfile: Record<Attitude, SpeedRange>
  speedPercent: number
  driftSpeed: number
  arcGuns: Record<ArcSide, GunProfile[]>
}

const DEFAULT_SPEED_PROFILE: Record<Attitude, SpeedRange> = {
  // A ship head to wind makes no way of her own — she drifts, at her drift
  // speed — so this is always 0 and is not offered for editing.
  in_irons: { max: 0 },
  beating: { max: 60 },
  reaching: { max: 100 },
  quarter_reaching: { max: 120 },
  running: { max: 110 },
}

/** A draft from saved settings, or the defaults a brand-new ship starts with. */
export function draftFromSettings(settings?: ShipSettings): ShipSettingsDraft {
  const arcGuns: Record<ArcSide, GunProfile[]> = { bow: [], stern: [], port: [], starboard: [] }
  for (const arc of settings?.firingArcs ?? []) arcGuns[arc.side] = arc.guns
  return {
    maxTurnPoints: settings?.maxTurnPoints ?? 6,
    foreAndAftRigged: settings?.foreAndAftRigged ?? false,
    baseWidth: settings?.baseWidth ?? 30,
    baseLength: settings?.baseLength ?? 80,
    speedProfile: settings?.speedProfile ?? DEFAULT_SPEED_PROFILE,
    speedPercent: speedMultiplierToPercent(settings?.speedMultiplier),
    driftSpeed: settings?.driftSpeed ?? 10,
    arcGuns,
  }
}

/**
 * The arcs a ship actually carries: any side whose guns amount to nothing is
 * left out. Arc ids are kept from `existing` where the side already had one.
 */
export function firingArcsFrom(arcGuns: Record<ArcSide, GunProfile[]>, existing: FiringArc[]): FiringArc[] {
  return (Object.entries(arcGuns) as [ArcSide, GunProfile[]][])
    .filter(([, guns]) => guns.some((g) => g.guns > 0 && g.ranges.extreme > 0))
    .map(([side, guns]) => ({
      id: existing.find((a) => a.side === side)?.id ?? uuid(),
      side,
      guns,
    }))
}

/** Settings as stored, from what the form holds. */
export function settingsFromDraft(draft: ShipSettingsDraft, existingArcs: FiringArc[] = []): ShipSettings {
  return {
    maxTurnPoints: draft.maxTurnPoints,
    foreAndAftRigged: draft.foreAndAftRigged,
    // In irons is never a sailing speed, whatever an older save may hold.
    speedProfile: { ...draft.speedProfile, in_irons: { max: 0 } },
    speedMultiplier: speedMultiplierFromPercent(draft.speedPercent),
    driftSpeed: draft.driftSpeed,
    baseWidth: draft.baseWidth,
    baseLength: draft.baseLength,
    firingArcs: firingArcsFrom(draft.arcGuns, existingArcs),
  }
}
