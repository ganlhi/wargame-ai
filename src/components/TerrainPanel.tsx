import { useGameStore } from '../stores/gameStore'
import type { TerrainType } from '../types'

const TERRAIN_COLORS: Record<TerrainType, { fill: string; border: string; label: string }> = {
  island: { fill: '#4ade80', border: '#22c55e', label: 'Island' },
  shoal: { fill: '#fbbf24', border: '#f59e0b', label: 'Shoal' },
  reef: { fill: '#f87171', border: '#ef4444', label: 'Reef' },
}

interface TerrainPanelProps {
  onAddClick: () => void
}

export function TerrainPanel({ onAddClick }: TerrainPanelProps) {
  const { currentGame, updateTerrain, removeTerrain } = useGameStore()

  if (!currentGame) return null

  const { terrain } = currentGame

  return (
    <div className="border-t border-gray-800 bg-gray-950 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Terrain ({terrain.length})
        </h3>
        <button
          onClick={onAddClick}
          className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
        >
          + Add
        </button>
      </div>

      {terrain.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-4">
          No terrain placed yet. Click "Add" and then click on the table to place vertices.
        </p>
      ) : (
        <ul className="space-y-1.5 max-h-40 overflow-y-auto">
          {terrain.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 p-2 rounded-lg text-xs transition-colors hover:bg-gray-800/50"
            >
              <span
                className="w-3 h-3 rounded-sm shrink-0"
                style={{ backgroundColor: TERRAIN_COLORS[t.type].fill }}
              />
              <select
                value={t.type}
                onChange={(e) => updateTerrain(t.id, { type: e.target.value as TerrainType })}
                className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                {(Object.keys(TERRAIN_COLORS) as TerrainType[]).map((type) => (
                  <option key={type} value={type}>
                    {TERRAIN_COLORS[type].label}
                  </option>
                ))}
              </select>
              <span className="text-gray-400 flex-1">
                {t.vertices.length} vert{t.vertices.length !== 1 ? 's' : 'ex'}
              </span>
              <span
                className="text-gray-500 hover:text-red-400 cursor-pointer px-1"
                onClick={() => removeTerrain(t.id)}
              >
                ✕
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export { TERRAIN_COLORS }
export type { TerrainType }
