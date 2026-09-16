import { useState } from 'react'
import { useGameStore } from '../stores/gameStore'
import { ATTITUDE_LABELS, COMPASS_LABELS } from '../utils/attitude'
import { formatBearing, originPoint, terrainReferencePoint, toBearing, unitReferencePoint } from '../utils/coordinates'
import { TERRAIN_COLORS } from '../utils/terrainStyles'

interface TablePanelProps {
  onAddShip: () => void
  /** Start placing a ship by tapping the water; only offered once there is an origin to read the tap against. */
  onPlaceShip: () => void
  onAddTerrain: () => void
  onEditUnit: (unitId: string) => void
  onEditTerrain: (terrainId: string) => void
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Everything on the table, with its current reading — the list the player
 * walks down each turn to bring the app up to date with what the models show.
 * Each row opens its form; the bearing shown is what was last entered, since
 * the app never moves anything itself.
 */
export function TablePanel({ onAddShip, onPlaceShip, onAddTerrain, onEditUnit, onEditTerrain }: TablePanelProps) {
  const currentGame = useGameStore((s) => s.currentGame)
  const removeTerrain = useGameStore((s) => s.removeTerrain)
  const [collapsed, setCollapsed] = useState(false)

  if (!currentGame) return null

  const { units, terrain } = currentGame
  const origin = originPoint(currentGame)
  const hasOrigin = !!currentGame.originId

  return (
    <div className="border-t border-gray-800 bg-gray-950">
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="text-sm font-semibold text-gray-300 uppercase tracking-wider cursor-pointer flex items-center gap-2"
          aria-expanded={!collapsed}
        >
          <span className="text-gray-500 text-xs">{collapsed ? '▸' : '▾'}</span>
          The table
          <span className="text-xs text-gray-500 font-normal normal-case tracking-normal">
            {plural(units.length, 'ship')} · {plural(terrain.length, 'terrain piece')}
          </span>
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onAddShip}
            className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
          >
            + Ship
          </button>
          {hasOrigin && (
            <button
              type="button"
              onClick={onPlaceShip}
              className="text-gray-300 hover:text-white border border-gray-700 px-2 py-1 rounded text-xs transition-colors cursor-pointer"
              title="Tap the water where the ship lies; the tap is read as a bearing from the origin ship"
            >
              Tap to place
            </button>
          )}
          <button
            type="button"
            onClick={onAddTerrain}
            disabled={!hasOrigin}
            title={hasOrigin ? 'Add a terrain piece' : 'Place a ship first — terrain is measured from the origin ship'}
            className="text-gray-300 hover:text-white border border-gray-700 px-2 py-1 rounded text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Terrain
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 pb-3 max-h-48 overflow-y-auto space-y-1">
          {units.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-3">
              Nothing on the table yet. The first ship placed becomes the origin every other position is
              measured from.
            </p>
          )}
          {units.map((u) => {
            const isOrigin = currentGame.originId === u.id
            const out = u.status === 'destroyed' || u.status === 'surrendered'
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => onEditUnit(u.id)}
                className="w-full grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 px-2 py-1.5 rounded-lg text-xs text-left hover:bg-gray-800/60 transition-colors cursor-pointer"
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full shrink-0 ${u.side === 'player' ? 'bg-blue-500' : 'bg-red-500'} ${out ? 'opacity-40' : ''}`}
                />
                <span className="min-w-0 flex items-center gap-1.5">
                  <span className={`truncate ${out ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{u.name}</span>
                  {isOrigin && (
                    <span className="text-[10px] px-1 rounded bg-sky-600/30 text-sky-300 shrink-0">origin</span>
                  )}
                  {u.status !== 'active' && (
                    <span className="text-[10px] px-1 rounded bg-gray-700 text-gray-300 shrink-0 capitalize">{u.status}</span>
                  )}
                </span>
                <span className="font-mono text-gray-400 whitespace-nowrap">
                  {isOrigin ? 'origin' : formatBearing(toBearing(unitReferencePoint(u), origin))}
                </span>
                <span className="text-gray-400 whitespace-nowrap">
                  <span className="font-mono">{COMPASS_LABELS[u.orientation]}</span>
                  <span className="text-gray-600"> · {ATTITUDE_LABELS[u.attitude].toLowerCase()}</span>
                </span>
              </button>
            )
          })}

          {terrain.map((t) => (
            <div
              key={t.id}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 px-2 py-1.5 rounded-lg text-xs hover:bg-gray-800/60 transition-colors"
            >
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: TERRAIN_COLORS[t.type].fill }} />
              <button
                type="button"
                onClick={() => onEditTerrain(t.id)}
                className="min-w-0 text-left text-gray-300 truncate cursor-pointer"
              >
                {TERRAIN_COLORS[t.type].label}
                <span className="text-gray-500">
                  {' · '}
                  {t.shape.kind === 'circle' ? `⌀${t.shape.width}mm` : `${t.shape.width}×${t.shape.height}mm`}
                </span>
              </button>
              <span className="font-mono text-gray-400 whitespace-nowrap">
                {formatBearing(toBearing(terrainReferencePoint(t), origin))}
              </span>
              <span className="flex items-center gap-1 justify-end">
                <button
                  type="button"
                  onClick={() => onEditTerrain(t.id)}
                  className="text-gray-500 hover:text-blue-400 cursor-pointer px-1"
                  aria-label="Edit terrain"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => removeTerrain(t.id)}
                  className="text-gray-500 hover:text-red-400 cursor-pointer px-1"
                  aria-label="Delete terrain"
                >
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
