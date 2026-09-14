import type {
  Attitude, GunType, RangeBand, Scale, ShipType, SpeedRange, WindStrength,
} from '../types'

/**
 * The rulebook's charts, transcribed.
 *
 * Nothing here is a setting: a ship is described by what she *is* — her type
 * and the guns she carries — and every number that follows from that is looked
 * up here against the game's scale and the weather. That is why speeds and
 * ranges are not entered anywhere in the app.
 *
 * Two conventions worth knowing, both the binder's own:
 *   - **Ranges** are printed in centimetres and are held here in millimetres
 *     (the unit the whole app measures the table in), so every figure is the
 *     chart's ×10.
 *   - **Speeds** are already in millimetres for a whole game turn, which the
 *     movement rules then split across the turn's five chunks.
 */

export const WIND_STRENGTH_LABELS: Record<WindStrength, string> = {
  slight_air: 'Slight air',
  light_breeze: 'Light breeze',
  gentle_breeze: 'Gentle breeze',
  moderate_breeze: 'Moderate breeze',
  fresh_breeze: 'Fresh breeze',
  gale: 'Gale',
}

/**
 * How the sailing charts group ships. Several types share one row — a 1st and
 * a 2nd rate sail alike even though the smaller ship turns a point quicker —
 * so the group a type belongs to is a separate thing from the type itself.
 */
type SpeedCategory =
  | 'rates_1_2' | 'rates_3' | 'rates_4' | 'american_4'
  | 'rates_5_6' | 'sloops_xebecs' | 'brigs_snows' | 'small_craft'

interface ShipTypeInfo {
  label: string
  /** Which row of the sailing charts she is rated on. */
  category: SpeedCategory
  /** Points she may turn in a game turn, from the movement chart. */
  turnPoints: number
}

export const SHIP_TYPE_INFO: Record<ShipType, ShipTypeInfo> = {
  rate_1: { label: '1st Rate', category: 'rates_1_2', turnPoints: 3 },
  rate_2: { label: '2nd Rate', category: 'rates_1_2', turnPoints: 4 },
  rate_3: { label: '3rd Rate', category: 'rates_3', turnPoints: 5 },
  rate_4: { label: '4th Rate', category: 'rates_4', turnPoints: 6 },
  large_frigate: { label: 'Large Frigate / Razee', category: 'american_4', turnPoints: 7 },
  rate_5: { label: '5th Rate', category: 'rates_5_6', turnPoints: 8 },
  rate_6: { label: '6th Rate', category: 'rates_5_6', turnPoints: 9 },
  sloop: { label: 'Sloop (Corvette)', category: 'sloops_xebecs', turnPoints: 9 },
  xebec: { label: 'Xebec', category: 'sloops_xebecs', turnPoints: 9 },
  brig: { label: 'Brig', category: 'brigs_snows', turnPoints: 9 },
  snow: { label: 'Snow', category: 'brigs_snows', turnPoints: 9 },
  bomb_ketch: { label: 'Bomb Ketch', category: 'brigs_snows', turnPoints: 10 },
  pojama: { label: 'Pojama', category: 'brigs_snows', turnPoints: 10 },
  galley: { label: 'Galley', category: 'brigs_snows', turnPoints: 10 },
  gondola: { label: 'Gondola', category: 'brigs_snows', turnPoints: 10 },
  polacca: { label: 'Polacca', category: 'brigs_snows', turnPoints: 10 },
  schooner: { label: 'Schooner', category: 'small_craft', turnPoints: 10 },
  lugger: { label: 'Lugger', category: 'small_craft', turnPoints: 10 },
  cutter: { label: 'Cutter', category: 'small_craft', turnPoints: 10 },
  gunboat: { label: 'Gunboat', category: 'small_craft', turnPoints: 10 },
  dhow: { label: 'Dhow', category: 'small_craft', turnPoints: 10 },
  baghala: { label: 'Baghala', category: 'small_craft', turnPoints: 10 },
  trabacolo: { label: 'Trabacolo', category: 'small_craft', turnPoints: 10 },
  proa: { label: 'Proa', category: 'small_craft', turnPoints: 10 },
  batil: { label: 'Batil', category: 'small_craft', turnPoints: 10 },
  galivat: { label: 'Galivat', category: 'small_craft', turnPoints: 10 },
  colonial_sloop: { label: 'Colonial Trade Sloop', category: 'small_craft', turnPoints: 10 },
}

/**
 * The scale a saved ship's gun ranges are held at. A saved ship belongs to no
 * game, and so to no scale; her ranges are re-read at the game's own scale the
 * moment she is imported into one, so this only keeps the library's stored
 * figures consistent with each other.
 */
export const REFERENCE_SCALE: Scale = '1/1200'

/** The default a new ship starts as: a 4th rate, middling in every respect. */
export const DEFAULT_SHIP_TYPE: ShipType = 'rate_4'

/** The gun a new profile starts as. */
export const DEFAULT_GUN_TYPE: GunType = 'long_24'

export const GUN_TYPE_LABELS: Record<GunType, string> = {
  long_48: '48# Long',
  long_42: '42# Long',
  long_36_livre: '36 Livre Long (38#)',
  long_36: '36# Long',
  long_32: '32# Long',
  long_30: '30# Long',
  long_29: '29# Long',
  long_24: '24# Long',
  long_18: '18# Long',
  long_12: '12# Long',
  long_9: '9# Long',
  long_8: '8# Long',
  long_6: '6# Long',
  long_4: '4# Long',
  long_3: '3# Long',
  swivel_half: '½# Swivel',
  carr_68: '68# Carronade',
  carr_42: '42# Carronade',
  carr_36: '36# Carronade',
  carr_32: '32# Carronade',
  carr_24: '24# Carronade',
  carr_18: '18# Carronade',
  carr_12: '12# Carronade',
}

/**
 * Outer edge of each band, in millimetres, in the order
 * `[point blank, close, medium, long, extreme]`.
 */
type BandEdges = [number, number, number, number, number]

const GUN_RANGES: Record<Scale, Record<GunType, BandEdges>> = {
  '1/700': {
    long_48: [20, 430, 940, 1460, 3430],
    long_42: [20, 430, 930, 1420, 3380],
    long_36_livre: [20, 410, 910, 1410, 3310],
    long_36: [20, 410, 890, 1370, 3260],
    long_32: [20, 390, 860, 1320, 3140],
    long_30: [20, 390, 840, 1290, 3090],
    long_29: [20, 390, 840, 1290, 3050],
    long_24: [20, 380, 790, 1200, 2880],
    long_18: [20, 340, 690, 1060, 2540],
    long_12: [20, 310, 620, 940, 2230],
    long_9: [20, 290, 570, 860, 2060],
    long_8: [20, 270, 550, 820, 1970],
    long_6: [20, 260, 510, 770, 1850],
    long_4: [20, 240, 480, 720, 1710],
    long_3: [20, 220, 450, 670, 1590],
    swivel_half: [20, 140, 260, 390, 930],
    carr_68: [20, 240, 390, 600, 1610],
    carr_42: [20, 240, 360, 550, 1470],
    carr_36: [20, 210, 340, 530, 1440],
    carr_32: [20, 170, 340, 510, 1420],
    carr_24: [20, 150, 310, 460, 1290],
    carr_18: [20, 140, 270, 410, 1170],
    carr_12: [20, 120, 240, 360, 1030],
  },
  '1/1200': {
    long_48: [20, 250, 550, 850, 2000],
    long_42: [20, 250, 540, 830, 1970],
    long_36_livre: [20, 240, 530, 820, 1930],
    long_36: [20, 240, 520, 800, 1900],
    long_32: [20, 230, 500, 770, 1830],
    long_30: [20, 230, 490, 750, 1800],
    long_29: [20, 230, 490, 750, 1780],
    long_24: [20, 220, 460, 700, 1680],
    long_18: [20, 200, 400, 620, 1480],
    long_12: [20, 180, 360, 550, 1300],
    long_9: [20, 170, 330, 500, 1200],
    long_8: [20, 160, 320, 480, 1150],
    long_6: [20, 150, 300, 450, 1080],
    long_4: [20, 140, 280, 420, 1000],
    long_3: [20, 130, 260, 390, 930],
    swivel_half: [20, 80, 150, 230, 540],
    carr_68: [20, 140, 230, 350, 940],
    carr_42: [20, 140, 210, 320, 860],
    carr_36: [20, 120, 200, 310, 840],
    carr_32: [20, 100, 200, 300, 830],
    carr_24: [20, 90, 180, 270, 750],
    carr_18: [20, 80, 160, 240, 680],
    carr_12: [20, 70, 140, 210, 600],
  },
}

/**
 * Millimetres a ship covers in a whole game turn, in the order the charts
 * print them: `[quarter reaching, running, reaching, beating, drifting]`.
 */
type SpeedRow = [number, number, number, number, number]

const SHIP_SPEEDS: Record<SpeedCategory, Record<WindStrength, Record<Scale, SpeedRow>>> = {
  rates_1_2: {
    slight_air: { '1/700': [154, 125, 117, 79, 31], '1/1200': [90, 73, 68, 46, 18] },
    light_breeze: { '1/700': [310, 249, 231, 154, 62], '1/1200': [181, 145, 135, 90, 36] },
    gentle_breeze: { '1/700': [423, 343, 319, 213, 86], '1/1200': [247, 200, 186, 124, 50] },
    moderate_breeze: { '1/700': [545, 434, 411, 271, 110], '1/1200': [318, 253, 240, 158, 64] },
    fresh_breeze: { '1/700': [776, 622, 583, 391, 154], '1/1200': [453, 363, 340, 228, 90] },
    gale: { '1/700': [466, 374, 353, 233, 94], '1/1200': [272, 218, 206, 136, 55] },
  },
  rates_3: {
    slight_air: { '1/700': [173, 137, 132, 86, 36], '1/1200': [101, 80, 77, 50, 21] },
    light_breeze: { '1/700': [348, 279, 261, 173, 69], '1/1200': [203, 163, 152, 101, 40] },
    gentle_breeze: { '1/700': [466, 374, 353, 233, 94], '1/1200': [272, 218, 206, 136, 55] },
    moderate_breeze: { '1/700': [583, 466, 439, 295, 117], '1/1200': [340, 272, 256, 172, 68] },
    fresh_breeze: { '1/700': [814, 651, 614, 411, 163], '1/1200': [475, 380, 358, 240, 95] },
    gale: { '1/700': [466, 374, 353, 233, 94], '1/1200': [272, 218, 206, 136, 55] },
  },
  rates_4: {
    slight_air: { '1/700': [195, 154, 147, 99, 41], '1/1200': [114, 90, 86, 58, 24] },
    light_breeze: { '1/700': [391, 310, 297, 201, 79], '1/1200': [228, 181, 173, 117, 46] },
    gentle_breeze: { '1/700': [507, 403, 382, 255, 105], '1/1200': [296, 235, 223, 149, 61] },
    moderate_breeze: { '1/700': [622, 497, 466, 310, 125], '1/1200': [363, 290, 272, 181, 73] },
    fresh_breeze: { '1/700': [855, 677, 641, 429, 180], '1/1200': [499, 395, 374, 250, 105] },
    gale: { '1/700': [429, 343, 324, 218, 86], '1/1200': [250, 200, 189, 127, 50] },
  },
  american_4: {
    slight_air: { '1/700': [233, 185, 178, 120, 48], '1/1200': [136, 108, 104, 70, 28] },
    light_breeze: { '1/700': [470, 374, 353, 238, 96], '1/1200': [274, 218, 206, 139, 56] },
    gentle_breeze: { '1/700': [607, 485, 456, 307, 122], '1/1200': [354, 283, 266, 179, 71] },
    moderate_breeze: { '1/700': [744, 593, 559, 374, 149], '1/1200': [434, 346, 326, 218, 87] },
    fresh_breeze: { '1/700': [1027, 812, 771, 512, 216], '1/1200': [599, 474, 450, 299, 126] },
    gale: { '1/700': [512, 408, 387, 261, 105], '1/1200': [299, 238, 226, 152, 61] },
  },
  rates_5_6: {
    slight_air: { '1/700': [386, 305, 295, 195, 81], '1/1200': [225, 178, 172, 114, 47] },
    light_breeze: { '1/700': [459, 363, 345, 233, 96], '1/1200': [268, 212, 201, 136, 56] },
    gentle_breeze: { '1/700': [667, 528, 506, 339, 139], '1/1200': [389, 308, 295, 198, 81] },
    moderate_breeze: { '1/700': [831, 656, 629, 423, 175], '1/1200': [485, 383, 367, 247, 102] },
    fresh_breeze: { '1/700': [1004, 792, 759, 512, 213], '1/1200': [586, 462, 443, 299, 124] },
    gale: { '1/700': [459, 363, 345, 233, 96], '1/1200': [268, 212, 201, 136, 56] },
  },
  sloops_xebecs: {
    slight_air: { '1/700': [355, 281, 269, 180, 74], '1/1200': [207, 164, 157, 105, 43] },
    light_breeze: { '1/700': [459, 363, 345, 233, 96], '1/1200': [268, 212, 201, 136, 56] },
    gentle_breeze: { '1/700': [773, 612, 583, 393, 163], '1/1200': [451, 357, 340, 229, 95] },
    moderate_breeze: { '1/700': [1004, 792, 756, 512, 213], '1/1200': [586, 462, 441, 299, 124] },
    fresh_breeze: { '1/700': [920, 728, 696, 466, 192], '1/1200': [537, 425, 406, 272, 112] },
    gale: { '1/700': [418, 329, 315, 213, 86], '1/1200': [244, 192, 184, 124, 50] },
  },
  brigs_snows: {
    slight_air: { '1/700': [178, 139, 134, 91, 38], '1/1200': [104, 81, 78, 53, 22] },
    light_breeze: { '1/700': [237, 189, 178, 120, 51], '1/1200': [138, 110, 104, 70, 30] },
    gentle_breeze: { '1/700': [393, 310, 297, 195, 84], '1/1200': [229, 181, 173, 114, 49] },
    moderate_breeze: { '1/700': [548, 429, 411, 274, 120], '1/1200': [320, 250, 240, 160, 70] },
    fresh_breeze: { '1/700': [782, 624, 586, 393, 158], '1/1200': [456, 364, 342, 229, 92] },
    gale: { '1/700': [158, 125, 120, 81, 31], '1/1200': [92, 73, 70, 47, 18] },
  },
  small_craft: {
    slight_air: { '1/700': [418, 329, 314, 213, 86], '1/1200': [244, 192, 183, 124, 50] },
    light_breeze: { '1/700': [560, 444, 423, 286, 120], '1/1200': [327, 259, 247, 167, 70] },
    gentle_breeze: { '1/700': [667, 528, 506, 339, 139], '1/1200': [389, 308, 295, 198, 81] },
    moderate_breeze: { '1/700': [773, 612, 583, 393, 163], '1/1200': [451, 357, 340, 229, 95] },
    fresh_breeze: { '1/700': [920, 728, 696, 470, 192], '1/1200': [537, 425, 406, 274, 112] },
    gale: { '1/700': [355, 281, 269, 180, 75], '1/1200': [207, 164, 157, 105, 44] },
  },
}

/** The band edges for a gun of this type at this scale. */
export function gunRanges(type: GunType, scale: Scale): Record<RangeBand, number> {
  const [pointBlank, close, medium, long, extreme] = GUN_RANGES[scale][type]
  return { point_blank: pointBlank, close, medium, long, extreme }
}

/** How far a gun of this type reaches at all. */
export function gunMaxRange(type: GunType, scale: Scale): number {
  return GUN_RANGES[scale][type][4]
}

function speedRow(shipType: ShipType, wind: WindStrength, scale: Scale): SpeedRow {
  return SHIP_SPEEDS[SHIP_TYPE_INFO[shipType].category][wind][scale]
}

/**
 * What this ship makes on each point of sail in these conditions. In irons is
 * always 0: head to wind she carries no way of her own and drifts instead, at
 * {@link driftSpeed}.
 */
export function speedProfile(
  shipType: ShipType,
  wind: WindStrength,
  scale: Scale,
): Record<Attitude, SpeedRange> {
  const [quarterReaching, running, reaching, beating] = speedRow(shipType, wind, scale)
  return {
    in_irons: { max: 0 },
    beating: { max: beating },
    reaching: { max: reaching },
    quarter_reaching: { max: quarterReaching },
    running: { max: running },
  }
}

/** How far the wind carries this ship in a turn with no way on. */
export function driftSpeed(shipType: ShipType, wind: WindStrength, scale: Scale): number {
  return speedRow(shipType, wind, scale)[4]
}

/** Points this ship may turn in a game turn. */
export function turnPoints(shipType: ShipType): number {
  return SHIP_TYPE_INFO[shipType].turnPoints
}

/**
 * The gun whose reach is closest to `extreme` at this scale. Saves written
 * before the charts were wired in hold typed-in distances rather than a gun
 * type, so the nearest gun is the reading that keeps such a ship fighting at
 * roughly the distances she was given. A reach of nothing says nothing about
 * what the gun was, so that takes the default instead.
 */
export function nearestGunType(extreme: number, scale: Scale): GunType {
  if (!(extreme > 0)) return DEFAULT_GUN_TYPE
  let best: GunType = DEFAULT_GUN_TYPE
  let bestDiff = Infinity
  for (const type of Object.keys(GUN_RANGES[scale]) as GunType[]) {
    const diff = Math.abs(gunMaxRange(type, scale) - extreme)
    if (diff < bestDiff) {
      best = type
      bestDiff = diff
    }
  }
  return best
}

/**
 * The ship type that best fits a typed-in top speed and turning allowance —
 * again, for saves written before ships were described by type. Speed leads,
 * since it is the figure with the wider spread; turning separates types that
 * share a row of the sailing charts, such as a 1st rate from a 2nd.
 */
export function nearestShipType(
  quarterReaching: number,
  maxTurnPoints: number,
  wind: WindStrength,
  scale: Scale,
): ShipType {
  let best: ShipType = DEFAULT_SHIP_TYPE
  let bestCost = Infinity
  for (const type of Object.keys(SHIP_TYPE_INFO) as ShipType[]) {
    const speed = speedRow(type, wind, scale)[0]
    const cost =
      Math.abs(speed - quarterReaching) / Math.max(1, speed) +
      Math.abs(turnPoints(type) - maxTurnPoints) * 0.05
    if (cost < bestCost) {
      best = type
      bestCost = cost
    }
  }
  return best
}
