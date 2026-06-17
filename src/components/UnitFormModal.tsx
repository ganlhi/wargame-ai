import { useState, useRef } from 'react'
import { v4 as uuid } from 'uuid'
import { useGameStore } from '../stores/gameStore'
import { computeAttitude, ATTITUDE_LABELS, COMPASS_LABELS } from '../utils/attitude'
import { ARC_SIDES, arcSideLabel } from '../types'
import type { Unit, UnitSide, AIStyle, UnitStatus, ArcSide, Attitude, SpeedRange } from '../types'

function OrientationSlider({
  initial,
  windDir,
  onChange,
}: {
  initial: number
  windDir: number
  onChange: (v: number) => void
}) {
  const [local, setLocal] = useState(initial)
  const committedRef = useRef(initial)
  const committed = committedRef.current
  const attitude = computeAttitude(windDir, local)
  const display = local

  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">Orientation</label>
      <div className="flex gap-2 items-center">
        <input
          type="range"
          min={0}
          max={31}
          value={display}
          onChange={(e) => {
            const v = Number(e.target.value)
            setLocal(v)
          }}
          onPointerUp={() => {
            if (committed !== local) {
              committedRef.current = local
              onChange(local)
            }
          }}
          onKeyUp={() => {
            if (committed !== local) {
              committedRef.current = local
              onChange(local)
            }
          }}
          className="flex-1 cursor-pointer accent-blue-500"
        />
        <span className="text-sm text-gray-200 font-mono whitespace-nowrap">{COMPASS_LABELS[local]}</span>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        Attitude: <span className="text-gray-300">{ATTITUDE_LABELS[attitude]}</span>
      </p>
    </div>
  )
}

interface UnitFormModalProps {
  unit?: Unit
  defaultPosition?: { x: number; y: number }
  onSave: (unit: Unit) => void
  onClose: () => void
}

export function UnitFormModal({ unit, defaultPosition, onSave, onClose }: UnitFormModalProps) {
  const windDirection = useGameStore((s) => s.currentGame?.windDirection ?? 0)
  const [name, setName] = useState(unit?.name ?? '')
  const [side, setSide] = useState<UnitSide>(unit?.side ?? 'player')
  const [posX, setPosX] = useState(unit?.position.x ?? defaultPosition?.x ?? 200)
  const [posY, setPosY] = useState(unit?.position.y ?? defaultPosition?.y ?? 200)
  const [orientation, setOrientation] = useState(unit?.orientation ?? 0)
  const [status, setStatus] = useState<UnitStatus>(unit?.status ?? 'active')
  const [aiStyle, setAiStyle] = useState<AIStyle>(unit?.aiStyle ?? 'cautious')
  const [maxTurnPoints, setMaxTurnPoints] = useState(unit?.maxTurnPoints ?? 6)
  const [arcRanges, setArcRanges] = useState<Record<ArcSide, number>>(() => {
    const result: Record<ArcSide, number> = { bow: 0, stern: 0, port: 0, starboard: 0 }
    for (const a of unit?.firingArcs ?? []) {
      result[a.side] = a.maxRange
    }
    return result
  })
  const [arcWeapons, setArcWeapons] = useState<Record<ArcSide, number>>(() => {
    const result: Record<ArcSide, number> = { bow: 0, stern: 0, port: 0, starboard: 0 }
    for (const a of unit?.firingArcs ?? []) {
      result[a.side] = a.weapons
    }
    return result
  })
  const defaultProfile: Record<Attitude, SpeedRange> = {
    in_irons: { max: 0 },
    beating: { max: 60 },
    reaching: { max: 100 },
    quarter_reaching: { max: 120 },
    running: { max: 110 },
  }
  const [driftSpeed, setDriftSpeed] = useState(unit?.driftSpeed ?? 10)
  const [baseWidth, setBaseWidth] = useState(unit?.baseWidth ?? 30)
  const [baseLength, setBaseLength] = useState(unit?.baseLength ?? 80)
  const [speedProfile, setSpeedProfile] = useState<Record<Attitude, SpeedRange>>(unit?.speedProfile ?? defaultProfile)

  const computedAttitude = computeAttitude(windDirection, orientation)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave({
      id: unit?.id ?? uuid(),
      name: name.trim(),
      side,
      position: { x: posX, y: posY },
      orientation,
      status,
      aiStyle: side === 'ai' ? aiStyle : 'cautious',
      maxTurnPoints,
      speedProfile,
      driftSpeed,
      baseWidth,
      baseLength,

      firingArcs: (Object.entries(arcRanges) as [ArcSide, number][])
        .filter(([, r]) => r > 0)
        .map(([side, maxRange]) => ({
          id: unit?.firingArcs.find((a) => a.side === side)?.id ?? uuid(),
          side,
          maxRange,
          weapons: arcWeapons[side] || 10,
        })),
      attitude: computedAttitude,
      prevAttitude: computedAttitude,
      prevMoveDistance: 0,
      hiddenAIOrder: null,
      playerOrder: null,
      hiddenAIFirePlan: null,
      lastFireChunk: null,
      isInIrons: false,
      // Grapple is a mutual relationship managed via the canvas unit panel
      // (setGrapple), not edited here — preserve whatever it currently is.
      grappledWith: unit?.grappledWith ?? null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 mx-2 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold mb-4">{unit ? 'Edit Unit' : 'New Unit'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3.5">

          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="HMS Victory"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Side</label>
            <div className="flex gap-2">
              {(['player', 'ai'] as UnitSide[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    side === s
                      ? s === 'player'
                        ? 'bg-blue-600 text-white'
                        : 'bg-red-600 text-white'
                      : 'bg-gray-800 text-gray-400 border border-gray-700'
                  }`}
                >
                  {s === 'player' ? 'Player' : 'AI'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Position X (mm)</label>
              <input
                type="number"
                value={posX}
                onChange={(e) => setPosX(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Position Y (mm)</label>
              <input
                type="number"
                value={posY}
                onChange={(e) => setPosY(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <OrientationSlider
            key={unit?.id ?? 'new'}
            initial={orientation}
            windDir={windDirection}
            onChange={(v) => setOrientation(v)}
          />

          <div>
            <label className="block text-xs text-gray-400 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as UnitStatus)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
            >
              <option value="active">Active</option>
              <option value="grappled">Grappled</option>
              <option value="immobilised">Immobilised</option>
              <option value="destroyed">Destroyed</option>
              <option value="surrendered">Surrendered</option>
            </select>
          </div>

          {side === 'ai' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">AI Style</label>
              <select
                value={aiStyle}
                onChange={(e) => setAiStyle(e.target.value as AIStyle)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                <option value="aggressive">Aggressive</option>
                <option value="cautious">Cautious</option>
                <option value="defensive">Defensive</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">Max Turn Points</label>
            <input
              type="number"
              min={0}
              max={32}
              value={maxTurnPoints}
              onChange={(e) => setMaxTurnPoints(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Base Width (mm)</label>
              <input
                type="number"
                min={0}
                value={baseWidth}
                onChange={(e) => setBaseWidth(Math.max(0, Number(e.target.value)))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Base Length (mm)</label>
              <input
                type="number"
                min={0}
                value={baseLength}
                onChange={(e) => setBaseLength(Math.max(0, Number(e.target.value)))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 -mt-1.5">Footprint of the model's base. The AI won't let its base overlap another ship's.</p>

          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
            <div className="text-xs text-gray-400 font-medium mb-2">Max Speed per Attitude (mm/turn)</div>
            <div className="space-y-1.5">
              {(Object.keys(defaultProfile) as Attitude[]).map((att) => (
                <div key={att} className="grid grid-cols-3 gap-1 items-center">
                  <span className="text-xs text-gray-300">{ATTITUDE_LABELS[att]}</span>
                  <input
                    type="number"
                    min={0}
                    value={speedProfile[att].max}
                    onChange={(e) =>
                      setSpeedProfile((prev) => ({
                        ...prev,
                        [att]: { max: Math.max(0, Number(e.target.value)) },
                      }))
                    }
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Max"
                  />
                  <span className="text-xs text-gray-500">mm</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Drift Speed (mm/chunk, when in irons)</label>
            <input
              type="number"
              min={0}
              value={driftSpeed}
              onChange={(e) => setDriftSpeed(Math.max(0, Number(e.target.value)))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
            <div className="text-xs text-gray-400 font-medium mb-2">Firing Arcs (set 0 mm to disable)</div>
            <div className="space-y-1.5">
              {ARC_SIDES.map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <span className="text-xs text-gray-300 w-20">{arcSideLabel(s)}</span>
                  <input
                    type="number"
                    min={0}
                    value={arcRanges[s]}
                    onChange={(e) => setArcRanges({ ...arcRanges, [s]: Math.max(0, Number(e.target.value)) })}
                    className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-500 w-6">mm</span>
                  <span className="text-xs text-gray-500">×</span>
                  <input
                    type="number"
                    min={0}
                    value={arcWeapons[s]}
                    onChange={(e) => setArcWeapons({ ...arcWeapons, [s]: Math.max(0, Number(e.target.value)) })}
                    className="w-12 bg-gray-800 border border-gray-700 rounded px-1.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-500">guns</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {unit ? 'Save Changes' : 'Add Unit'}
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
