import { useState } from 'react'
import { useGameStore } from '../stores/gameStore'
import { COMPASS_LABELS } from '../utils/attitude'

const WIND_POINTS = Array.from({ length: 32 }, (_, i) => i)

interface TableSetupProps {
  onComplete: () => void
}

export function TableSetup({ onComplete }: TableSetupProps) {
  const { currentGame, setTableDimensions, setWindDirection } = useGameStore()
  const [width, setWidth] = useState(String(currentGame?.tableWidth ?? 1200))
  const [height, setHeight] = useState(String(currentGame?.tableHeight ?? 900))
  const [windDir, setWindDir] = useState(currentGame?.windDirection ?? 0)

  const handleSubmit = () => {
    const w = Math.max(100, parseInt(width) || 1200)
    const h = Math.max(100, parseInt(height) || 900)
    setTableDimensions(w, h)
    setWindDirection(windDir)
    onComplete()
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-lg w-full space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Table Setup</h2>
          <p className="text-sm text-gray-400 mt-1">Configure your battlefield dimensions and wind direction.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Width (mm)</label>
            <input
              type="number"
              min={100}
              step={10}
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Height (mm)</label>
            <input
              type="number"
              min={100}
              step={10}
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">Wind Direction</label>
          <div className="relative w-48 h-48 mx-auto">
            <div className="absolute inset-0 rounded-full border-2 border-gray-700" />
            {WIND_POINTS.map((p) => {
              const angle = (p * 360) / 32 - 90
              const rad = (angle * Math.PI) / 180
              const r = 88
              const cx = 96 + r * Math.cos(rad)
              const cy = 96 + r * Math.sin(rad)
              const isSelected = p === windDir
              const isCardinal = p % 8 === 0
              const label = COMPASS_LABELS[p]
              return (
                <button
                  key={p}
                  onClick={() => setWindDir(p)}
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
                  title={`${label} (point ${p})`}
                >
                  {isCardinal ? label : ''}
                </button>
              )
            })}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <div className="text-lg font-bold text-blue-400">{COMPASS_LABELS[windDir]}</div>
                <div className="text-xs text-gray-500">Point {windDir}</div>
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
          Continue to Terrain Editor
        </button>
      </div>
    </div>
  )
}
