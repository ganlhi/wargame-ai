import { v4 as uuid } from 'uuid'
import type { ShipSettings, ShipTemplate } from '../types'

/** Just the settings of a ship, copied, with nothing of her game state along for the ride. */
export function shipSettingsOf(source: ShipSettings): ShipSettings {
  return {
    maxTurnPoints: source.maxTurnPoints,
    foreAndAftRigged: source.foreAndAftRigged,
    speedProfile: {
      ...source.speedProfile,
      // In irons is never a sailing speed, whatever the source may hold.
      in_irons: { max: 0 },
    },
    speedMultiplier: source.speedMultiplier,
    driftSpeed: source.driftSpeed,
    baseWidth: source.baseWidth,
    baseLength: source.baseLength,
    firingArcs: source.firingArcs.map((arc) => ({
      ...arc,
      guns: arc.guns.map((g) => ({ ...g, ranges: { ...g.ranges } })),
    })),
  }
}

/**
 * Settings ready to go onto another ship: a copy with fresh ids on every arc
 * and gun profile, since those are keyed within the ship they belong to and two
 * ships built from one template must stay editable independently.
 */
export function cloneShipSettings(source: ShipSettings): ShipSettings {
  const copy = shipSettingsOf(source)
  return {
    ...copy,
    firingArcs: copy.firingArcs.map((arc) => ({
      ...arc,
      id: uuid(),
      guns: arc.guns.map((g) => ({ ...g, id: uuid() })),
    })),
  }
}

/** Templates are matched by name when saving, so "Victory" and "victory " are the same ship. */
export const templateKey = (name: string): string => name.trim().toLocaleLowerCase()

export function findTemplateByName(
  templates: ShipTemplate[],
  name: string,
): ShipTemplate | undefined {
  const key = templateKey(name)
  return key ? templates.find((t) => templateKey(t.name) === key) : undefined
}

/** Alphabetical, the order the library is shown in. */
export function sortTemplates(templates: ShipTemplate[]): ShipTemplate[] {
  return [...templates].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}
