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

export interface FiringArc {
  id: string
  minAngle: number
  maxAngle: number
  maxRange: number
}

export interface SpeedRange {
  min: number
  max: number
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
  firingArcs: FiringArc[]
  attitude: Attitude
  isInIrons: boolean
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
  tableWidth: number
  tableHeight: number
  windDirection: number
  terrain: TableTerrain[]
  units: Unit[]
  currentTurn: number
  currentPhase: GamePhase
  backgroundImage?: string
}
