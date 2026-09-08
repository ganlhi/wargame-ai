import type { TerrainType } from '../types'

/** Fill/border colours and display label for each terrain type. */
export const TERRAIN_COLORS: Record<TerrainType, { fill: string; border: string; label: string }> = {
  island: { fill: '#4ade80', border: '#22c55e', label: 'Island' },
  shoal: { fill: '#fbbf24', border: '#f59e0b', label: 'Shoal' },
  reef: { fill: '#f87171', border: '#ef4444', label: 'Reef' },
}

export const TERRAIN_TYPES = Object.keys(TERRAIN_COLORS) as TerrainType[]

/** The terrain types as dropdown options. */
export const TERRAIN_TYPE_OPTIONS = TERRAIN_TYPES.map((value) => ({
  value,
  label: TERRAIN_COLORS[value].label,
}))
