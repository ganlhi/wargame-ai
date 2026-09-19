import { useState } from 'react'
import { useGameStore } from '../stores/gameStore'
import { ATTITUDE_LABELS, COMPASS_LABELS, computeAttitude } from '../utils/attitude'
import { fromBearing, originName, originPoint, toBearing } from '../utils/coordinates'
import type { Unit } from '../types'
import { BearingInput } from './BearingInput'

interface MoveShipModalProps {
  unit: Unit
  /**
   * Hand the job back to the map: dismiss the dialog and let the player tap
   * the water instead. Left out for the origin ship, who has nothing to read
   * a tap against.
   */
  onTapTheWater?: () => void
  onClose: () => void
}

/**
 * Where a ship now lies and which way she is pointing, in one place.
 *
 * Bringing the table up to date is a pass down every ship, and on a tablet a
 * ship is moved by typing rather than by pointing: there is no mouse to drag,
 * the map is a poor ruler, and a heading is a point of the rose rather than
 * something aimed at. So Move opens this — her heading, and, unless she is the
 * origin, the bearing a player reads across the table to her. The origin ship
 * reads *origin* wherever she lies, so for her only the heading is entered.
 *
 * Nothing is written until *Move her*, so a dialog opened by mistake costs
 * nothing; the map's tap-the-water placement is still an option away for
 * anyone with a pointer.
 */
export function MoveShipModal({ unit, onTapTheWater, onClose }: MoveShipModalProps) {
  const currentGame = useGameStore((s) => s.currentGame)
  const updateUnit = useGameStore((s) => s.updateUnit)

  const origin = currentGame ? originPoint(currentGame) : { x: 0, y: 0 }
  const anchorName = currentGame ? originName(currentGame) : null
  const isOrigin = currentGame?.originId === unit.id
  const windDirection = currentGame?.windDirection ?? 0

  const [orientation, setOrientation] = useState(unit.orientation)
  const [bearing, setBearing] = useState(() => toBearing(unit.position, origin))

  const attitude = computeAttitude(windDirection, orientation, unit.foreAndAftRigged)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isOrigin) {
      // She is the reference point: her bearing is meaningless and her
      // position is whatever it already was.
      updateUnit(unit.id, { orientation })
    } else {
      const center = fromBearing(bearing, origin)
      updateUnit(unit.id, {
        orientation,
        position: { x: Math.round(center.x), y: Math.round(center.y) },
      })
    }
    onClose()
  }

  const turnBy = (points: number) => setOrientation((o) => (o + points + 32) % 32)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 mx-2 max-w-sm w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold mb-1">Move {unit.name}</h2>
        <p className="text-xs text-gray-500 mb-4">
          {isOrigin
            ? 'She is the origin: she reads origin wherever she sails, so only her heading is entered here.'
            : `As she now lies on the table, read from ${anchorName ?? 'the origin ship'}.`}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="text-xs text-gray-400">Heading</label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => turnBy(-1)}
                  className="w-7 h-7 rounded border border-gray-700 text-gray-300 hover:text-white text-xs leading-none cursor-pointer"
                  aria-label="One point to port"
                  title="One point to port"
                >
                  &larr;
                </button>
                <span className="font-mono text-sm text-gray-200 w-12 text-center">
                  {COMPASS_LABELS[orientation]}
                </span>
                <button
                  type="button"
                  onClick={() => turnBy(1)}
                  className="w-7 h-7 rounded border border-gray-700 text-gray-300 hover:text-white text-xs leading-none cursor-pointer"
                  aria-label="One point to starboard"
                  title="One point to starboard"
                >
                  &rarr;
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={31}
              value={orientation}
              onChange={(e) => setOrientation(Number(e.target.value))}
              className="w-full cursor-pointer accent-blue-500"
              aria-label="Heading"
            />
            <p className="text-xs text-gray-500 mt-1">
              Attitude: <span className="text-gray-300">{ATTITUDE_LABELS[attitude]}</span>
            </p>
          </div>

          {!isOrigin && (
            <div className="border-t border-gray-800 pt-3">
              <p className="text-xs text-gray-400 mb-2">
                Centre of the base, from{' '}
                <span className="text-gray-200">{anchorName ?? 'the origin ship'}</span>
              </p>
              <BearingInput value={bearing} onChange={setBearing} />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              Move her
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>

          {onTapTheWater && (
            <button
              type="button"
              onClick={onTapTheWater}
              className="w-full text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
            >
              Tap the water instead
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
