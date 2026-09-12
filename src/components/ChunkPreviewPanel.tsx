import { useGameStore } from '../stores/gameStore'
import { unitsAtChunk } from '../game/movement'
import { COMPASS_LABELS } from '../utils/attitude'
import { formatOffset, originPoint, toOffset, unitReferencePoint } from '../utils/coordinates'

const CHUNKS = 5

interface Props {
  /** 1–5: the chunk whose end is being shown. */
  chunk: number
  onChange: (chunk: number) => void
}

/**
 * Once the orders are revealed, the player has to walk every model along its
 * track chunk by chunk — fire is resolved mid-move, so the intermediate poses
 * matter as much as the final one. This panel scrubs the map through the turn
 * and reads out where each ship stands at the chosen step: the stern point,
 * measured from the origin *as the origin itself stands at that step*, and the
 * heading. That is what the player measures out on the table.
 */
export function ChunkPreviewPanel({ chunk, onChange }: Props) {
  const currentGame = useGameStore((s) => s.currentGame)
  if (!currentGame) return null

  const units = unitsAtChunk(currentGame.units, currentGame.windDirection, chunk)
  const origin = originPoint({ ...currentGame, units })
  const listed = units.filter((u) => u.status !== 'destroyed' && u.status !== 'surrendered')

  const step = (delta: number) => onChange(Math.max(1, Math.min(CHUNKS, chunk + delta)))

  return (
    <div className="bg-gray-900/90 border border-gray-700 rounded-lg px-3 py-2.5 backdrop-blur-sm w-80 max-w-[calc(100vw-1rem)] pointer-events-auto">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 shrink-0">
          End of chunk <span className="text-white font-medium">{chunk}</span>
          <span className="text-gray-600"> / {CHUNKS}</span>
        </span>
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={chunk <= 1}
          className="ml-auto w-6 h-6 rounded border border-gray-700 text-gray-300 hover:text-white disabled:opacity-35 disabled:cursor-default text-sm leading-none cursor-pointer"
          aria-label="Previous chunk"
        >
          &lsaquo;
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={chunk >= CHUNKS}
          className="w-6 h-6 rounded border border-gray-700 text-gray-300 hover:text-white disabled:opacity-35 disabled:cursor-default text-sm leading-none cursor-pointer"
          aria-label="Next chunk"
        >
          &rsaquo;
        </button>
      </div>
      <input
        type="range"
        min={1}
        max={CHUNKS}
        step={1}
        value={chunk}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-1.5 accent-purple-500 cursor-pointer"
        aria-label="Chunk shown on the map"
      />
      <div className="flex justify-between px-0.5 -mt-0.5 text-[10px] text-gray-600">
        {Array.from({ length: CHUNKS }, (_, i) => (
          <span key={i} className={i + 1 === chunk ? 'text-purple-300' : ''}>{i + 1}</span>
        ))}
      </div>

      <div className="mt-2 border-t border-gray-800 pt-2 max-h-40 overflow-y-auto space-y-1">
        {listed.map((u) => {
          const isOrigin = currentGame.originId === u.id
          return (
            <div key={u.id} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-2 text-xs">
              <span className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`inline-block w-2 h-2 rounded-full shrink-0 ${u.side === 'player' ? 'bg-blue-500' : 'bg-red-500'}`}
                />
                <span className="text-gray-200 truncate max-w-[7rem]">{u.name}</span>
              </span>
              <span className="font-mono text-gray-400 truncate">
                {isOrigin ? 'origin' : formatOffset(toOffset(unitReferencePoint(u), origin))}
              </span>
              <span className="text-gray-400 whitespace-nowrap">
                {COMPASS_LABELS[u.orientation]}
                <span className="text-gray-600"> · {u.orientation}pts</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
