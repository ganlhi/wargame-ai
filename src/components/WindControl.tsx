import { useState } from 'react'
import { useGameStore } from '../stores/gameStore'
import { COMPASS_LABELS, windTowardPoint } from '../utils/attitude'
import { WIND_STRENGTHS } from '../types'
import type { WindStrength } from '../types'
import { WIND_STRENGTH_LABELS } from '../data/binder'
import { Select } from './Select'

const WIND_POINTS = Array.from({ length: 32 }, (_, i) => i)

/**
 * The wind, as a button in the header that reads it out and a dialog that
 * sets it. Both its direction and its strength are re-entered turn by turn
 * as the weather turns, so they live on the battlefield rather than behind a
 * setup screen. Direction is entered and shown as the point the wind blows
 * *toward* — the way the arrow on the map reads — and stored as the opposite
 * point, the one it blows *from*, which is what the attitude rules work in.
 */
export function WindControl() {
  const windDirection = useGameStore((s) => s.currentGame?.windDirection ?? 0)
  const windStrength = useGameStore((s) => s.currentGame?.windStrength ?? 'moderate_breeze')
  const setWindDirection = useGameStore((s) => s.setWindDirection)
  const setWindStrength = useGameStore((s) => s.setWindStrength)
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 rounded px-2 py-1 transition-colors cursor-pointer whitespace-nowrap"
        title="Set the wind's direction and strength"
      >
        Wind &rarr; <span className="font-mono text-gray-100">{COMPASS_LABELS[windTowardPoint(windDirection)]}</span>
        <span className="text-gray-500"> · </span>
        {WIND_STRENGTH_LABELS[windStrength]}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl p-5 mx-2 max-w-sm w-full space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-base font-semibold">Wind</h2>
              <p className="text-xs text-gray-500 mt-1">
                Every ship's speeds are read against the strength, and her point of sail against the
                direction. Changing either drops any orders already revealed.
              </p>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Strength</label>
              <Select<WindStrength>
                value={windStrength}
                onChange={setWindStrength}
                ariaLabel="Wind strength"
                className="w-full"
                options={WIND_STRENGTHS.map((w) => ({ value: w, label: WIND_STRENGTH_LABELS[w] }))}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-3">Blowing toward</label>
              <div className="relative w-48 h-48 mx-auto">
                <div className="absolute inset-0 rounded-full border-2 border-gray-700" />
                {WIND_POINTS.map((p) => {
                  const angle = (p * 360) / 32 - 90
                  const rad = (angle * Math.PI) / 180
                  const r = 88
                  const cx = 96 + r * Math.cos(rad)
                  const cy = 96 + r * Math.sin(rad)
                  // The ring is a geographic compass; selecting point `p` means the
                  // wind blows toward `p`, which is stored as the opposite (from) point.
                  const isSelected = p === windTowardPoint(windDirection)
                  const isCardinal = p % 8 === 0
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setWindDirection(windTowardPoint(p))}
                      className="absolute cursor-pointer"
                      style={{
                        left: cx - 12,
                        top: cy - 12,
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: isSelected ? '#3b82f6' : 'transparent',
                        border: isSelected ? '2px solid #60a5fa' : '1px solid transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: isCardinal ? 9 : 7,
                        fontWeight: isCardinal ? 700 : 400,
                        color: isSelected ? '#fff' : isCardinal ? '#d1d5db' : '#6b7280',
                      }}
                      title={`Blowing toward ${COMPASS_LABELS[p]} (point ${p})`}
                    >
                      {isCardinal ? COMPASS_LABELS[p] : ''}
                    </button>
                  )
                })}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <div className="text-lg font-bold text-blue-400">{COMPASS_LABELS[windTowardPoint(windDirection)]}</div>
                    <div className="text-xs text-gray-500">blowing toward · from {COMPASS_LABELS[windDirection]}</div>
                  </div>
                </div>
              </div>
              <div className="flex justify-center mt-3 gap-2">
                <button
                  type="button"
                  onClick={() => setWindDirection((windDirection + 31) % 32)}
                  className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 border border-gray-700 rounded transition-colors cursor-pointer"
                  aria-label="One point anticlockwise"
                >
                  ←
                </button>
                <input
                  type="range"
                  min={0}
                  max={31}
                  value={windTowardPoint(windDirection)}
                  onChange={(e) => setWindDirection(windTowardPoint(Number(e.target.value)))}
                  className="w-32"
                  aria-label="Wind direction"
                />
                <button
                  type="button"
                  onClick={() => setWindDirection((windDirection + 1) % 32)}
                  className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 border border-gray-700 rounded transition-colors cursor-pointer"
                  aria-label="One point clockwise"
                >
                  →
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  )
}
