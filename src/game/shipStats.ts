import type { Attitude, FiringArc, GameState, Scale, ShipType, SpeedRange, Unit, WindStrength } from '../types'
import { RANGE_BANDS } from '../types'
import { driftSpeed, gunRanges, speedProfile, turnPoints } from '../data/binder'
import { computeAttitude } from '../utils/attitude'

/**
 * Everything about a game that a ship's cached figures are read against: the
 * scale the models are built to, how hard it is blowing, and which way — the
 * charts need the first two, her attitude the third.
 */
export interface Conditions {
  scale: Scale
  windStrength: WindStrength
  windDirection: number
}

export function conditionsOf(game: Pick<GameState, 'scale' | 'windStrength' | 'windDirection'>): Conditions {
  return { scale: game.scale, windStrength: game.windStrength, windDirection: game.windDirection }
}

/**
 * What the binder says a ship of this type does in these conditions — the
 * fields of a unit that are looked up rather than entered.
 */
export function shipStats(
  shipType: ShipType,
  { scale, windStrength }: Pick<Conditions, 'scale' | 'windStrength'>,
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
 * A unit with its looked-up figures brought back in line with the charts and
 * the wind: speeds and drift from her type, the scale and the weather, turning
 * from her type, every gun's ranges from its type and the scale, and her
 * attitude from her heading and the wind's direction.
 *
 * Those fields are caches, not settings — nothing in the app ever writes them
 * by hand, so running this over a unit whenever she or the conditions change
 * is what keeps them true. It hands back the very same object when they
 * already are, so a re-rate that changes nothing costs nothing downstream.
 */
export function resolveUnit(unit: Unit, conditions: Conditions): Unit {
  const stats = shipStats(unit.shipType, conditions)
  const attitude = computeAttitude(conditions.windDirection, unit.orientation, unit.foreAndAftRigged)
  const isInIrons = attitude === 'in_irons'
  if (
    sameStats(unit, stats) &&
    sameRanges(unit, conditions.scale) &&
    unit.attitude === attitude &&
    unit.isInIrons === isInIrons
  ) {
    return unit
  }
  return {
    ...unit,
    ...stats,
    firingArcs: resolveArcs(unit.firingArcs, conditions.scale),
    attitude,
    isInIrons,
  }
}

/**
 * The game with every ship re-rated against its scale, wind strength and wind
 * direction. Run on load and on every write that could change any of them, so
 * nothing downstream ever has to wonder whether a speed, a range or an
 * attitude is stale.
 */
export function resolveGame(game: GameState): GameState {
  const conditions = conditionsOf(game)
  const units = game.units.map((u) => resolveUnit(u, conditions))
  return units.every((u, i) => u === game.units[i]) ? game : { ...game, units }
}
