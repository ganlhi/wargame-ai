import { useGameStore } from '../stores/gameStore'
import type { TerrainType } from '../types'
import { formatOffset, originPoint, toOffset } from '../utils/coordinates'
import { Select } from './Select'
import { TERRAIN_COLORS, TERRAIN_TYPE_OPTIONS } from '../utils/terrainStyles'

interface TerrainPanelProps {
  onAddClick: () => void
  onEditTerrain?: (terrainId: string) => void
}

export function TerrainPanel({ onAddClick, onEditTerrain }: TerrainPanelProps) {
  const { currentGame, updateTerrain, removeTerrain } = useGameStore()

  if (!currentGame) return null

  const { terrain } = currentGame
  const origin = originPoint(currentGame)

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
          No terrain placed yet. Click "Add" to describe a piece by shape, size and position.
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
              <Select<TerrainType>
                value={t.type}
                onChange={(type) => updateTerrain(t.id, { type })}
                size="sm"
                ariaLabel="Terrain type"
                options={TERRAIN_TYPE_OPTIONS}
              />
              <span className="text-gray-400 flex-1 truncate">
                {t.shape.kind === 'circle'
                  ? `⌀${t.shape.width}mm`
                  : `${t.shape.width}×${t.shape.height}mm`}
                {' · '}
                {currentGame.originId === t.id
                  ? 'origin'
                  : formatOffset(toOffset(t.center, origin))}
              </span>
              {onEditTerrain && (
                <span
                  className="text-gray-500 hover:text-blue-400 cursor-pointer px-1"
                  onClick={() => onEditTerrain(t.id)}
                >
                  ✎
                </span>
              )}
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
