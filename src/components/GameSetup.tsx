import { useState } from 'react'
import { useGameStore } from '../stores/gameStore'
import { COMPASS_LABELS, windTowardPoint } from '../utils/attitude'
import { SCALES, WIND_STRENGTHS } from '../types'
import { WIND_STRENGTH_LABELS } from '../data/binder'
import { Select } from './Select'
import type { WindStrength } from '../types'

const WIND_POINTS = Array.from({ length: 32 }, (_, i) => i)

interface GameSetupProps {
  onComplete: () => void
}

export function GameSetup({ onComplete }: GameSetupProps) {
  const { currentGame, setWindDirection, setWindStrength, setScale } = useGameStore()
  const [windDir, setWindDir] = useState(currentGame?.windDirection ?? 0)

  const handleSubmit = () => {
    setWindDirection(windDir)
    onComplete()
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-lg w-full space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Game Setup</h2>
          <p className="text-sm text-gray-400 mt-1">
            The table is treated as infinite — there are no edges to configure. Set the scale and
            the wind, then describe the terrain and ships; the first thing you place becomes the
            origin all other positions are measured from.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Scale</label>
          <div className="flex gap-2">
            {SCALES.map((scale) => (
              <button
                key={scale}
                onClick={() => setScale(scale)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  currentGame?.scale === scale
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 border border-gray-700'
                }`}
              >
                {scale}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Speeds and gun ranges come from the rulebook's charts at this scale. Worth settling
            now: the table is measured in millimetres, so changing it later would leave every
            position meaning something else.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Wind Strength</label>
          <Select<WindStrength>
            value={currentGame?.windStrength ?? 'moderate_breeze'}
            onChange={setWindStrength}
            ariaLabel="Wind strength"
            className="w-full"
            options={WIND_STRENGTHS.map((w) => ({ value: w, label: WIND_STRENGTH_LABELS[w] }))}
          />
          <p className="text-xs text-gray-500 mt-2">
            How hard it is blowing, which every ship's speeds are read against. It can be changed
            from the battlefield as the weather turns.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">Wind Direction (blowing toward)</label>
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
              const isSelected = p === windTowardPoint(windDir)
              const isCardinal = p % 8 === 0
              const label = COMPASS_LABELS[p]
              return (
                <button
                  key={p}
                  onClick={() => setWindDir(windTowardPoint(p))}
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
                  title={`Blowing toward ${label} (point ${p})`}
                >
                  {isCardinal ? label : ''}
                </button>
              )
            })}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <div className="text-lg font-bold text-blue-400">{COMPASS_LABELS[windTowardPoint(windDir)]}</div>
                <div className="text-xs text-gray-500">blowing toward</div>
              </div>
            </div>
          </div>
          <div className="flex justify-center mt-3 gap-2">
            <button
              onClick={() => setWindDir((windDir + 31) % 32)}
              className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 border border-gray-700 rounded transition-colors cursor-pointer"
            >
              ←
            </button>
            <input
              type="range"
              min={0}
              max={31}
              value={windDir}
              onChange={(e) => setWindDir(Number(e.target.value))}
              className="w-32"
            />
            <button
              onClick={() => setWindDir((windDir + 1) % 32)}
              className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 border border-gray-700 rounded transition-colors cursor-pointer"
            >
              →
            </button>
          </div>
        </div>

        <button
          onClick={handleSubmit}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
        >
          Continue to the Battlefield
        </button>
      </div>
    </div>
  )
}
