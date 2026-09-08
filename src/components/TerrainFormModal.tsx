import { useState } from 'react'
import { useGameStore } from '../stores/gameStore'
import { TERRAIN_COLORS, TERRAIN_TYPES } from '../utils/terrainStyles'
import { OffsetInput } from './OffsetInput'
import { COMPASS_LABELS } from '../utils/attitude'
import { TERRAIN_SHAPE_KINDS } from '../types'
import type { TableTerrain, TerrainShapeKind, TerrainType } from '../types'
import { fromOffset, originName, originPoint, toOffset } from '../utils/coordinates'

const KIND_LABELS: Record<TerrainShapeKind, string> = {
  circle: 'Circle',
  ellipse: 'Ellipse',
  rectangle: 'Rectangle',
}

interface TerrainFormModalProps {
  terrain?: TableTerrain
  onClose: () => void
}

/**
 * Terrain is entered as a simplified primitive placed by its centre, rather
 * than traced vertex by vertex: on an infinite table there is no photo to trace
 * over, so the player measures the piece and types it in.
 */
export function TerrainFormModal({ terrain, onClose }: TerrainFormModalProps) {
  const currentGame = useGameStore((s) => s.currentGame)
  const addTerrain = useGameStore((s) => s.addTerrain)
  const updateTerrain = useGameStore((s) => s.updateTerrain)

  const origin = currentGame ? originPoint(currentGame) : { x: 0, y: 0 }
  const anchorName = currentGame ? originName(currentGame) : null
  // The very first entity placed *is* the origin, so it has nothing to be
  // offset from.
  const isFirstEntity = !currentGame?.originId
  const isOrigin = !!terrain && currentGame?.originId === terrain.id

  const [type, setType] = useState<TerrainType>(terrain?.type ?? 'island')
  const [kind, setKind] = useState<TerrainShapeKind>(terrain?.shape.kind ?? 'circle')
  const [width, setWidth] = useState(terrain?.shape.width ?? 200)
  const [height, setHeight] = useState(terrain?.shape.height ?? 120)
  const [rotation, setRotation] = useState(terrain?.shape.rotation ?? 0)
  const [offset, setOffset] = useState(() =>
    terrain ? toOffset(terrain.center, origin) : { east: 0, south: 0 },
  )

  if (!currentGame) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const center =
      isFirstEntity || isOrigin ? (terrain?.center ?? { x: 0, y: 0 }) : fromOffset(offset, origin)
    const shape = { kind, width, height, rotation }
    if (terrain) {
      updateTerrain(terrain.id, { type, center, shape })
    } else {
      addTerrain({ type, center, shape })
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 mx-2 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold mb-4">{terrain ? 'Edit Terrain' : 'New Terrain'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Type</label>
            <div className="flex gap-2">
              {TERRAIN_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer border ${
                    type === t
                      ? 'text-white border-transparent'
                      : 'bg-gray-800 text-gray-400 border-gray-700'
                  }`}
                  style={type === t ? { backgroundColor: TERRAIN_COLORS[t].border } : undefined}
                >
                  {TERRAIN_COLORS[t].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Shape</label>
            <div className="flex gap-2">
              {TERRAIN_SHAPE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    kind === k ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 border border-gray-700'
                  }`}
                >
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                {kind === 'circle' ? 'Diameter (mm)' : 'Width E–W (mm)'}
              </label>
              <input
                type="number"
                min={1}
                value={width}
                onChange={(e) => setWidth(Math.max(1, Number(e.target.value)))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            {kind !== 'circle' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Length N–S (mm)</label>
                <input
                  type="number"
                  min={1}
                  value={height}
                  onChange={(e) => setHeight(Math.max(1, Number(e.target.value)))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}
          </div>

          {kind !== 'circle' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Rotation &mdash; <span className="text-gray-300 font-mono">{COMPASS_LABELS[rotation]}</span>
              </label>
              <input
                type="range"
                min={0}
                max={31}
                value={rotation}
                onChange={(e) => setRotation(Number(e.target.value))}
                className="w-full cursor-pointer accent-blue-500"
              />
              <p className="text-xs text-gray-500 mt-0.5">
                Turns the shape clockwise; the long axis points {COMPASS_LABELS[rotation]}.
              </p>
            </div>
          )}

          <div className="border-t border-gray-800 pt-3">
            {isFirstEntity || isOrigin ? (
              <p className="text-xs text-gray-500">
                {isOrigin
                  ? 'This piece is the coordinate origin — everything else is measured from its centre.'
                  : 'This is the first thing on the table, so it becomes the coordinate origin. Everything placed afterwards is measured from its centre.'}
              </p>
            ) : (
              <>
                <p className="text-xs text-gray-400 mb-2">
                  Centre, measured from <span className="text-gray-200">{anchorName ?? 'the origin'}</span>
                </p>
                <OffsetInput value={offset} onChange={setOffset} />
              </>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              {terrain ? 'Save Changes' : 'Add Terrain'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
