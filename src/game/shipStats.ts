import type { Attitude, FiringArc, GameState, Scale, ShipType, SpeedRange, Unit, WindStrength } from '../types'
import { RANGE_BANDS } from '../types'
import { driftSpeed, gunRanges, speedProfile, turnPoints } from '../data/binder'

/**
 * Everything about a game that the binder's charts are read against: the scale
 * the models are built to and how hard it is blowing.
 */
export interface Conditions {
  scale: Scale
  windStrength: WindStrength
}

export function conditionsOf(game: Pick<GameState, 'scale' | 'windStrength'>): Conditions {
  return { scale: game.scale, windStrength: game.windStrength }
}

/**
 * What the binder says a ship of this type does in these conditions — the
 * fields of a unit that are looked up rather than entered.
 */
export function shipStats(
  shipType: ShipType,
  { scale, windStrength }: Conditions,
): { maxTurnPoints: number; speedProfile: Record<Attitude, SpeedRange>; driftSpeed: number } {
  return {
    maxTurnPoints: turnPoints(shipType),
    speedProfile: speedProfile(shipType, windStrength, scale),
    driftSpeed: driftSpeed(shipType, windStrength, scale),
  }
}

/** The same arcs with every gun's band edges read from the binder at this scale. */
export function resolveArcs(arcs: FiringArc[], scale: Scale): FiringArc[] {
  return arcs.map((arc) => ({
    ...arc,
    guns: arc.guns.map((g) => ({ ...g, ranges: gunRanges(g.type, scale) })),
  }))
}

function sameStats(unit: Unit, stats: ReturnType<typeof shipStats>): boolean {
  if (unit.maxTurnPoints !== stats.maxTurnPoints || unit.driftSpeed !== stats.driftSpeed) return false
  const attitudes = Object.keys(stats.speedProfile) as Attitude[]
  return attitudes.every((a) => unit.speedProfile?.[a]?.max === stats.speedProfile[a].max)
}

function sameRanges(unit: Unit, scale: Scale): boolean {
  return unit.firingArcs.every((arc) =>
    arc.guns.every((g) => {
      const ranges = gunRanges(g.type, scale)
      return RANGE_BANDS.every((band) => g.ranges?.[band] === ranges[band])
    }),
  )
}

/**
 * A unit with its looked-up figures brought back in line with the charts:
 * speeds and drift from her type, the scale and the weather, turning from her
 * type, and every gun's ranges from its type and the scale.
 *
 * Those fields are caches, not settings — nothing in the app ever writes them
 * by hand, so running this over a unit whenever she or the conditions change
 * is what keeps them true. It hands back the very same object when they
 * already are, so a re-rate that changes nothing costs nothing downstream.
 */
export function resolveUnit(unit: Unit, conditions: Conditions): Unit {
  const stats = shipStats(unit.shipType, conditions)
  if (sameStats(unit, stats) && sameRanges(unit, conditions.scale)) return unit
  return { ...unit, ...stats, firingArcs: resolveArcs(unit.firingArcs, conditions.scale) }
}

/**
 * The game with every ship re-rated against its scale and wind strength. Run
 * on load and on every write that could change any of the three, so nothing
 * downstream ever has to wonder whether a speed or a range is stale.
 */
export function resolveGame(game: GameState): GameState {
  const conditions = conditionsOf(game)
  const units = game.units.map((u) => resolveUnit(u, conditions))
  return units.every((u, i) => u === game.units[i]) ? game : { ...game, units }
}
