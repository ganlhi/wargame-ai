export const COMPASS_LABELS = [
  'N', 'NbE', 'NNE', 'NEbN', 'NE', 'NEbE', 'ENE', 'EbN',
  'E', 'EbS', 'ESE', 'SEbE', 'SE', 'SEbS', 'SSE', 'SbE',
  'S', 'SbW', 'SSW', 'SWbS', 'SW', 'SWbW', 'WSW', 'WbS',
  'W', 'WbN', 'WNW', 'NWbW', 'NW', 'NWbN', 'NNW', 'NbW',
]

import type { Attitude } from '../types'

/**
 * `windDirection` is stored as the compass point the wind blows *from* (the
 * convention all movement/attitude logic relies on). For display we show the
 * point it blows *toward* — the opposite point, 16 points (180°) away.
 */
export function windTowardPoint(windDirection: number): number {
  return (windDirection + 16) % 32
}

/**
 * How many points off the wind the ship's bow is: 0 = head to wind, 16 = dead
 * downwind, counted symmetrically to port and starboard so both tacks give the
 * same number.
 */
export function pointsOffWind(windDirection: number, orientation: number): number {
  const relative = ((windDirection - orientation) % 32 + 32) % 32
  return relative > 16 ? 32 - relative : relative
}

/**
 * The last point off the wind at which a ship is still in irons — everything
 * above it up to 7 is beating. A square rig cannot sail closer than 6 points;
 * a fore-and-aft rig points one point higher, so it is already beating at 5.
 */
export function inIronsLimit(foreAndAftRigged: boolean): number {
  return foreAndAftRigged ? 4 : 5
}

export function computeAttitude(
  windDirection: number,
  orientation: number,
  foreAndAftRigged: boolean,
): Attitude {
  const angle = pointsOffWind(windDirection, orientation)

  if (angle <= inIronsLimit(foreAndAftRigged)) return 'in_irons'
  if (angle <= 7) return 'beating'
  if (angle <= 9) return 'reaching'
  if (angle <= 13) return 'quarter_reaching'
  return 'running'
}

export const ATTITUDE_LABELS: Record<Attitude, string> = {
  in_irons: 'In Irons',
  beating: 'Beating',
  reaching: 'Reaching',
  quarter_reaching: 'Quarter Reaching',
  running: 'Running',
}
