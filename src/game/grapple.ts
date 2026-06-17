import type { Unit } from '../types'

/**
 * Release a unit (and its current partner, if any) from a grapple. Status is
 * reset to 'active' only when it was 'grappled', so an independently-set status
 * like 'destroyed' or 'immobilised' is preserved.
 */
function release(units: Unit[], unitId: string): Unit[] {
  const u = units.find((x) => x.id === unitId)
  const partnerId = u?.grappledWith ?? null
  return units.map((x) =>
    x.id === unitId || x.id === partnerId
      ? { ...x, grappledWith: null, status: x.status === 'grappled' ? 'active' : x.status }
      : x,
  )
}

/**
 * Grapple `id` to `otherId` (mutual), or release `id` when `otherId` is null.
 * Either unit is first detached from any prior grapple so a ship is never
 * grappled to two others at once.
 */
export function applyGrapple(units: Unit[], id: string, otherId: string | null): Unit[] {
  let next = release(units, id)
  if (otherId) {
    next = release(next, otherId)
    next = next.map((u) => {
      if (u.id === id) return { ...u, grappledWith: otherId, status: 'grappled' as const }
      if (u.id === otherId) return { ...u, grappledWith: id, status: 'grappled' as const }
      return u
    })
  }
  return next
}

/**
 * Remove a unit and free any partner that was grappled to it.
 */
export function clearGrappleForRemoved(units: Unit[], removedId: string): Unit[] {
  return units
    .filter((u) => u.id !== removedId)
    .map((u) =>
      u.grappledWith === removedId
        ? { ...u, grappledWith: null, status: u.status === 'grappled' ? 'active' : u.status }
        : u,
    )
}
