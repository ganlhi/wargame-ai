export type AIStyle = 'aggressive' | 'cautious' | 'defensive'

export type UnitStatus = 'active' | 'grappled' | 'immobilised' | 'destroyed' | 'surrendered'

export type Attitude = 'in_irons' | 'beating' | 'reaching' | 'quarter_reaching' | 'running'

export interface SavedGame {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  unitCount: number
}

export interface GameSettings {
  tableWidth: number
  tableHeight: number
  windDirection: number
}

export interface Game {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  settings: GameSettings
  units: unknown[]
  currentTurn: number
}
