export type AIStyle = 'aggressive' | 'cautious' | 'defensive'

export type UnitStatus = 'active' | 'grappled' | 'immobilised' | 'destroyed' | 'surrendered'

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

export type GamePhase = 'setup' | 'orders' | 'reveal' | 'resolve' | 'game_over'

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

export interface ActionLogEntry {
  turn: number
  unitId?: string
  unitName?: string
  text: string
}

export interface FirePlan {
  targetId: string
  chunkIndex: number
  arcSide: ArcSide
  /** The closest band the shot falls in — how good a shot it is. */
  band: RangeBand
  /** Guns bearing, each weighted by its band's to-hit modifier. */
  effectiveGuns: number
}

/**
 * A close-quarters intent an aggressive AI declares for the turn:
 * `grapple` = close to contact and grapple the target this turn;
 * `board` = already grappled, press a boarding action against the target.
 */
export interface AIAction {
  type: 'grapple' | 'board'
  targetId: string
}

export interface Unit {
  id: string
  name: string
  side: UnitSide
  position: { x: number; y: number }
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
   * her `shipType`; see `resolveUnitStats`, which rewrites it on every write.
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
   * write — see `resolveUnitStats`.
   */
  speedProfile: Record<Attitude, SpeedRange>
  /**
   * Scales every figure in `speedProfile`, so one decimal makes a ship faster
   * or slower overall without re-entering each point of sail. 1 = as entered,
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
  firingArcs: FiringArc[]
  attitude: Attitude
  isInIrons: boolean
  // Id of the unit this one is grappled to (mutual). null when not grappled.
  grappledWith: string | null
  /**
   * While a tack is under way, the direction the ship is swinging. The rules
   * require it to keep turning the same way until it is beating on the far
   * side, and the geometry alone is ambiguous — a ship head to wind could have
   * arrived there from either tack — so the direction has to be remembered
   * rather than re-derived. null when not tacking.
   */
  tackDirection: 'port' | 'starboard' | null
  prevAttitude: Attitude
  /**
   * Distance actually covered in the last movement phase, which sets this
   * turn's minimum (half of it). `null` means the ship has not moved yet, so
   * there is no last turn to halve — see `minMoveDistance`.
   */
  prevMoveDistance: number | null
  hiddenAIOrder: MovementPlan | null
  playerOrder: MovementPlan | null
  /**
   * For each broadside or chase arc, the chunk it last fired on — and so the
   * chunk it becomes loaded again on, a full turn later. Reloading is tracked
   * per arc, not per ship: a starboard broadside fired on chunk 2 leaves the
   * port guns free to fire from chunk 0. An arc with no entry is loaded, and
   * every arc that does not fire in a turn is loaded again by the next one.
   */
  lastFireChunks: Partial<Record<ArcSide, number>>
  hiddenAIFirePlan: FirePlan | null
  hiddenAIAction: AIAction | null
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

export interface GameState {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  schemaVersion: number
  /**
   * Id of the unit or terrain piece that anchors the coordinate system. The
   * table is infinite, so there is no fixed frame to measure from: the first
   * entity added to the game becomes the origin and every other position is
   * reported relative to it. Its own coordinates stay (0, 0) even after it
   * moves. null only while the game is empty.
   */
  originId: string | null
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
  currentTurn: number
  currentPhase: GamePhase
  actionLog: ActionLogEntry[]
}
