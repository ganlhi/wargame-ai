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

export function computeAttitude(windDirection: number, orientation: number): Attitude {
  const relative = ((windDirection - orientation) % 32 + 32) % 32
  const angle = relative > 16 ? 32 - relative : relative

  if (angle <= 4) return 'in_irons'
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
