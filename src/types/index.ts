export type AIStyle = 'aggressive' | 'cautious' | 'defensive'

export type UnitStatus = 'active' | 'immobilised' | 'destroyed' | 'surrendered'

export type Attitude = 'in_irons' | 'beating' | 'reaching' | 'quarter_reaching' | 'running'

/**
 * The scale the models are built to. Everything the binder gives — gun ranges
 * and sailing speeds alike — is tabulated for both, so it is a property of the
 * game rather than of any one ship, fixed when the game is created.
 */
export const SCALES = ['1/700', '1/1200'] as const
export type Scale = (typeof SCALES)[number]

/**
 * How hard it is blowing. Speeds are read from the binder's charts by ship
 * category *and* wind strength, so this is as much a part of a game's state as
 * the wind's direction — and, like it, may change as the game goes on.
 */
export const WIND_STRENGTHS = [
  'slight_air', 'light_breeze', 'gentle_breeze', 'moderate_breeze', 'fresh_breeze', 'gale',
] as const
export type WindStrength = (typeof WIND_STRENGTHS)[number]

/**
 * What kind of ship she is. This is all that is entered about how she sails:
 * her speeds on every point of sail, her drift and how many points she can
 * turn in a game turn are read from the binder's charts from this, the game's
 * scale and the wind strength. See `src/data/binder.ts`.
 */
export const SHIP_TYPES = [
  'rate_1', 'rate_2', 'rate_3', 'rate_4', 'large_frigate', 'rate_5', 'rate_6',
  'sloop', 'xebec', 'brig', 'snow', 'bomb_ketch', 'pojama', 'galley', 'gondola', 'polacca',
  'schooner', 'lugger', 'cutter', 'gunboat', 'dhow', 'baghala', 'trabacolo', 'proa', 'batil',
  'galivat', 'colonial_sloop',
] as const
export type ShipType = (typeof SHIP_TYPES)[number]

/**
 * A kind of gun from the binder's range charts. A gun's four band edges follow
 * from this and the game's scale, so choosing the type and saying how many
 * there are is the whole of entering an armament.
 */
export const GUN_TYPES = [
  'long_48', 'long_42', 'long_36_livre', 'long_36', 'long_32', 'long_30', 'long_29', 'long_24',
  'long_18', 'long_12', 'long_9', 'long_8', 'long_6', 'long_4', 'long_3', 'swivel_half',
  'carr_68', 'carr_42', 'carr_36', 'carr_32', 'carr_24', 'carr_18', 'carr_12',
] as const
export type GunType = (typeof GUN_TYPES)[number]

export type TerrainType = 'island' | 'shoal' | 'reef'

export type UnitSide = 'player' | 'ai'

/**
 * Where a turn stands. `input`: the player is describing the table — wind,
 * headings, bearings, status. `orders`: the AI's plans for that table are
 * revealed and drawn, and stay so until *Next turn* clears them or an edit to
 * anything they were planned against discards them.
 */
export type GamePhase = 'input' | 'orders'

export interface SavedGame {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  unitCount: number
}

export const TERRAIN_SHAPE_KINDS = ['circle', 'ellipse', 'rectangle'] as const
export type TerrainShapeKind = (typeof TERRAIN_SHAPE_KINDS)[number]

/**
 * A terrain piece is entered as a simplified primitive rather than a traced
 * polygon: pick a shape, give its size, and place its **centre**.
 *
 * `width` runs along the shape's own east-west axis before rotation (and is the
 * diameter of a circle), `height` along its north-south axis. `rotation` is a
 * 32-point compass value turning the shape clockwise; both `height` and
 * `rotation` are ignored for circles.
 */
export interface TerrainShape {
  kind: TerrainShapeKind
  width: number
  height: number
  rotation: number
}

export interface TableTerrain {
  id: string
  type: TerrainType
  /** Centre of the shape, in world mm. This is the placement reference point. */
  center: { x: number; y: number }
  shape: TerrainShape
}

export const ARC_SIDES = ['bow', 'stern', 'port', 'starboard'] as const
export type ArcSide = (typeof ARC_SIDES)[number]

export function arcSideToAngles(side: ArcSide): { minAngle: number; maxAngle: number } {
  switch (side) {
    case 'bow':
      return { minAngle: 326.25, maxAngle: 33.75 }
    case 'stern':
      return { minAngle: 146.25, maxAngle: 213.75 }
    case 'port':
      return { minAngle: 247.5, maxAngle: 292.5 }
    case 'starboard':
      return { minAngle: 67.5, maxAngle: 112.5 }
  }
}

export function arcSideLabel(side: ArcSide): string {
  switch (side) {
    case 'bow':
      return 'Bow'
    case 'stern':
      return 'Stern'
    case 'port':
      return 'Port'
    case 'starboard':
      return 'Starboard'
  }
}

export const RANGE_BANDS = ['point_blank', 'close', 'medium', 'long', 'extreme'] as const
export type RangeBand = (typeof RANGE_BANDS)[number]

/**
 * To-hit modifier for a shot taken in each band. Close range is the yardstick;
 * beyond it a shot is worth a fraction of itself, and an extreme-range one is
 * barely worth the powder. These are what make closing the range worth the
 * risk of doing so, so the AI weighs every candidate shot by them rather than
 * by a raw count of guns.
 *
 * Point blank is the one band the binder does not give a multiplier for: at
 * that range every hit is automatic, where a close-range broadside still lands
 * only the dice roll's share of itself (×1.0 with +13 on a d100, so about two
 * thirds on average). Muzzle to muzzle is therefore worth about half again as
 * much as close, which is the figure used here.
 */
export const RANGE_BAND_MODIFIERS: Record<RangeBand, number> = {
  point_blank: 1.6,
  close: 1,
  medium: 0.54,
  long: 0.4,
  extreme: 0.07,
}

export const RANGE_BAND_LABELS: Record<RangeBand, string> = {
  point_blank: 'Point Blank',
  close: 'Close',
  medium: 'Medium',
  long: 'Long',
  extreme: 'Extreme',
}

/**
 * One kind of gun in an arc, and how many of them. A broadside is rarely
 * uniform — 24-pounders on the gun deck and carronades on the quarterdeck
 * reach quite different distances — so an arc carries a list of these rather
 * than a single range and gun count.
 */
export interface GunProfile {
  id: string
  /** Which gun out of the binder's charts; its label and ranges follow from it. */
  type: GunType
  guns: number
  /**
   * The *outer* edge of each band, so a shot falls in the first band whose
   * distance it is still within, and `ranges.extreme` is how far the guns
   * reach at all.
   *
   * Read from the binder for `type` at the game's scale rather than entered,
   * and rewritten from there on every write — see `resolveUnitStats`. A value
   * that came off disk (or out of a saved ship, which belongs to no game and
   * so to no scale) is never to be trusted.
   */
  ranges: Record<RangeBand, number>
}

export interface FiringArc {
  id: string
  side: ArcSide
  guns: GunProfile[]
}

/** Which band `dist` falls in for these guns, or null if it is out of reach. */
export function bandForDistance(profile: GunProfile, dist: number): RangeBand | null {
  for (const band of RANGE_BANDS) {
    if (dist <= profile.ranges[band]) return band
  }
  return null
}

/** How far an arc reaches at all: the longest extreme range any of its guns has. */
export function arcMaxRange(arc: FiringArc): number {
  return arc.guns.reduce((max, g) => Math.max(max, g.ranges.extreme), 0)
}

/** Guns in the arc, irrespective of range. */
export function arcGunCount(arc: FiringArc): number {
  return arc.guns.reduce((n, g) => n + g.guns, 0)
}

/**
 * The weight of metal the arc would actually land at `dist`: every gun counted
 * at its own band's to-hit modifier. 0 means nothing in the arc reaches.
 */
export function arcEffectiveGuns(arc: FiringArc, dist: number): number {
  let total = 0
  for (const g of arc.guns) {
    const band = bandForDistance(g, dist)
    if (band) total += g.guns * RANGE_BAND_MODIFIERS[band]
  }
  return total
}

/**
 * The closest band any of the arc's guns puts a target at `dist` in — the
 * quality of the best shot available, used to decide whether one is worth
 * taking at all. null when nothing reaches.
 */
export function arcBestBand(arc: FiringArc, dist: number): RangeBand | null {
  for (const band of RANGE_BANDS) {
    if (arc.guns.some((g) => g.guns > 0 && bandForDistance(g, dist) === band)) return band
  }
  return null
}

export interface SpeedRange {
  max: number
}

export interface Unit {
  id: string
  name: string
  side: UnitSide
  /**
   * The centre of the base, in world mm — the point her bearing from the
   * origin ship is measured to. Only ever what the player last entered: the
   * app never moves a ship itself.
   */
  position: { x: number; y: number }
  /** Heading, on the 32-point compass (0 = N, 8 = E). */
  orientation: number
  status: UnitStatus
  aiStyle: AIStyle
  /**
   * What kind of ship she is. Her speeds, her drift and her turning all come
   * from the binder's charts for this, so it is entered in place of them.
   */
  shipType: ShipType
  /**
   * Points she may turn in a game turn. From the binder's movement chart for
   * her `shipType`; see `resolveUnit`, which rewrites it on every write.
   */
  maxTurnPoints: number
  /**
   * Fore-and-aft rigged ships point one point closer to the wind: they are in
   * irons only to 4 points off it, and beating from 5, where a square rig is
   * still in irons at 5 and only starts beating at 6.
   */
  foreAndAftRigged: boolean
  /**
   * Top speed on each point of sail. `in_irons` is always 0: a ship head to
   * wind carries no way of her own and goes where the wind takes her, at
   * `driftSpeed`, so there is no sailing speed to quote.
   *
   * Read from the binder's sailing charts for her `shipType` at the game's
   * scale and wind strength, not entered, and rewritten from there on every
   * write — see `resolveUnit`.
   */
  speedProfile: Record<Attitude, SpeedRange>
  /**
   * Scales every figure in `speedProfile`, so one decimal makes a ship faster
   * or slower overall without re-entering each point of sail. 1 = as charted,
   * below it shortened down, above it under full sail, 0 = dead in the water.
   */
  speedMultiplier: number
  /**
   * How far the wind carries her in a turn with no way on. From the binder's
   * charts alongside `speedProfile`, and derived the same way.
   */
  driftSpeed: number
  // Footprint of the physical base the model is mounted on, in mm. `baseLength`
  // runs along the bow–stern axis, `baseWidth` across (port–starboard). Used for
  // collision avoidance so ships never overlap. 0 disables the check.
  baseWidth: number
  baseLength: number
  /**
   * Her guns, arc by arc. Every ship carries a layout, the player's included:
   * the AI judges how dangerous an enemy is, and how far to keep from her, by
   * what she mounts.
   */
  firingArcs: FiringArc[]
  /**
   * Her point of sail, from her heading and the wind. A cache like the charted
   * figures: `resolveUnit` recomputes it on every write.
   */
  attitude: Attitude
  /** Head to wind: `attitude === 'in_irons'`. Cached alongside it. */
  isInIrons: boolean
  /**
   * While a tack is under way, the direction the ship is swinging. The rules
   * require it to keep turning the same way until it is beating on the far
   * side, and the geometry alone is ambiguous — a ship head to wind could have
   * arrived there from either tack — so the direction has to be remembered
   * rather than re-derived. null when not tacking.
   *
   * Part of the AI's memory of its own last order (see `GameState`); for a
   * player ship it is never set.
   */
  tackDirection: 'port' | 'starboard' | null
  /**
   * Her attitude as her last orders were revealed. With her attitude now, it
   * says whether the previous turn was spent entirely beating, which is what a
   * tack requires. null until she has been given an order.
   */
  prevAttitude: Attitude | null
  /**
   * Distance the AI's last order sailed her, which sets this turn's minimum
   * (half of it). `null` means she has not been given an order yet, so there is
   * no last turn to halve — see `minMoveDistance`.
   */
  prevMoveDistance: number | null
  /** The revealed order for this turn, for an AI ship while `phase === 'orders'`. */
  aiOrder: MovementPlan | null
}

/**
 * What is the ship's own, whichever game she is in: her type, her rig, her
 * base and her guns. Where she stands, which way she heads, whose side she
 * fights on and how she is faring belong to the game and are left out — and so
 * do her actual speeds and ranges, which belong to the game's scale and
 * weather and are read from the binder wherever she turns up.
 */
export type ShipSettings = Pick<
  Unit,
  | 'shipType'
  | 'foreAndAftRigged'
  | 'speedMultiplier'
  | 'baseWidth'
  | 'baseLength'
  | 'firingArcs'
>

/**
 * A ship's settings saved under a name, so a class of ship is typed in once
 * and imported into every later game. Kept outside any game: a library the
 * unit form reads from and writes to.
 */
export interface ShipTemplate extends ShipSettings {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface MoveChunk {
  distance: number
  turn?: {
    direction: 'port' | 'starboard'
    points: number
  }
}

export interface MovementPlan {
  chunks: [MoveChunk, MoveChunk, MoveChunk, MoveChunk, MoveChunk]
  totalTurnPoints: number
  effectiveMaxSpeed: number
  /**
   * A declared tack: the ship carries no way on for the whole turn, drifting
   * downwind while it swings through the wind. Set from the moment the tack is
   * declared, which is why it can't be inferred from the ship's current
   * attitude — on that first turn the ship is still beating.
   */
  isTack?: boolean
}

/**
 * A game is a description of the table, re-entered every turn, plus the AI's
 * orders for it while they are revealed. There is no turn counter and no log:
 * the app simulates nothing, and the only history it keeps is the little the
 * AI needs about its own last order (see `Unit.prevAttitude`,
 * `Unit.prevMoveDistance` and `Unit.tackDirection`).
 */
export interface GameState {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  schemaVersion: number
  /**
   * Id of the ship every bearing is measured from. The table is infinite, so
   * there is no fixed frame: the first ship placed becomes the origin and reads
   * *origin* wherever she is. Only a ship can be the origin, which is why no
   * terrain can be placed before one. null only while the game has no ships.
   */
  originId: string | null
  /** Where the wind blows *from*, on the 32-point compass. */
  windDirection: number
  /**
   * How hard it is blowing. With `scale`, this is what every ship's speeds are
   * read from, so changing it re-rates the whole fleet at once.
   */
  windStrength: WindStrength
  /**
   * The scale the models are built to. Gun ranges and speeds are tabulated for
   * both scales, and positions are measured in millimetres on the table, so
   * this is fixed when the game is created.
   */
  scale: Scale
  terrain: TableTerrain[]
  units: Unit[]
  phase: GamePhase
}
