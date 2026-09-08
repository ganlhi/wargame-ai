export type AIStyle = 'aggressive' | 'cautious' | 'defensive'

export type UnitStatus = 'active' | 'grappled' | 'immobilised' | 'destroyed' | 'surrendered'

export type Attitude = 'in_irons' | 'beating' | 'reaching' | 'quarter_reaching' | 'running'

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

export interface FiringArc {
  id: string
  side: ArcSide
  maxRange: number
  weapons: number
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
  maxTurnPoints: number
  /**
   * Fore-and-aft rigged ships point one point closer to the wind: they are in
   * irons only to 4 points off it, and beating from 5, where a square rig is
   * still in irons at 5 and only starts beating at 6.
   */
  foreAndAftRigged: boolean
  speedProfile: Record<Attitude, SpeedRange>
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
  terrain: TableTerrain[]
  units: Unit[]
  currentTurn: number
  currentPhase: GamePhase
  actionLog: ActionLogEntry[]
}
