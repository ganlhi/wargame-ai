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

export interface TableTerrain {
  id: string
  vertices: { x: number; y: number }[]
  type: TerrainType
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
  prevAttitude: Attitude
  prevMoveDistance: number
  hiddenAIOrder: MovementPlan | null
  playerOrder: MovementPlan | null
  lastFireChunk: number | null
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
}

export interface GameState {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  schemaVersion: number
  tableWidth: number
  tableHeight: number
  windDirection: number
  terrain: TableTerrain[]
  units: Unit[]
  currentTurn: number
  currentPhase: GamePhase
  actionLog: ActionLogEntry[]
  backgroundImage?: string
}
