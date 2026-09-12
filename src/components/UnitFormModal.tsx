import { useState, useRef } from 'react'
import { v4 as uuid } from 'uuid'
import { useGameStore } from '../stores/gameStore'
import { computeAttitude, ATTITUDE_LABELS, COMPASS_LABELS, SAILING_ATTITUDES } from '../utils/attitude'
import { ARC_SIDES, RANGE_BANDS, RANGE_BAND_LABELS, RANGE_BAND_MODIFIERS, arcSideLabel } from '../types'
import type {
  Unit, UnitSide, AIStyle, UnitStatus, ArcSide, Attitude, SpeedRange, GunProfile, RangeBand,
} from '../types'
import { speedMultiplierFromPercent, speedMultiplierToPercent } from '../game/movement'
import { OffsetInput } from './OffsetInput'
import { Select } from './Select'
import {
  centerFromSternMidpoint, fromOffset, originName, originPoint, sternMidpoint, toOffset,
} from '../utils/coordinates'

function OrientationSlider({
  initial,
  windDir,
  foreAndAftRigged,
  onChange,
}: {
  initial: number
  windDir: number
  foreAndAftRigged: boolean
  onChange: (v: number) => void
}) {
  const [local, setLocal] = useState(initial)
  const committedRef = useRef(initial)
  const committed = committedRef.current
  const attitude = computeAttitude(windDir, local, foreAndAftRigged)
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

function newGunProfile(): GunProfile {
  return {
    id: uuid(),
    name: 'Guns',
    guns: 10,
    ranges: { close: 100, medium: 200, long: 300, extreme: 400 },
  }
}

/**
 * The guns in one arc. A ship rarely has a uniform broadside — long guns on the
 * gun deck, carronades above — and each kind reaches its own four distances, so
 * an arc is a list rather than a single range and count.
 */
function ArcGunsEditor({
  side,
  guns,
  onChange,
  mirror,
}: {
  side: ArcSide
  guns: GunProfile[]
  onChange: (guns: GunProfile[]) => void
  /**
   * The opposite broadside, when this arc has one. Ships almost always carry the
   * same guns on both sides, so the second broadside is entered by copying the
   * first rather than typing it twice.
   */
  mirror?: { side: ArcSide; guns: GunProfile[] }
}) {
  const update = (index: number, patch: Partial<GunProfile>) =>
    onChange(guns.map((g, i) => (i === index ? { ...g, ...patch } : g)))

  const updateRange = (index: number, band: RangeBand, value: number) =>
    onChange(
      guns.map((g, i) =>
        i === index ? { ...g, ranges: { ...g.ranges, [band]: Math.max(0, value) } } : g,
      ),
    )

  // Copies take fresh ids: a profile is keyed by its id within its arc, and the
  // two broadsides must stay editable independently once mirrored.
  const copyFromMirror = () =>
    mirror && onChange(mirror.guns.map((g) => ({ ...g, id: uuid(), ranges: { ...g.ranges } })))

  return (
    <div className="border border-gray-700/50 rounded-lg p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-300">{arcSideLabel(side)}</span>
        <div className="flex items-center gap-3">
          {mirror && (
            <button
              type="button"
              onClick={copyFromMirror}
              disabled={mirror.guns.length === 0}
              title={
                mirror.guns.length === 0
                  ? `Nothing bears on the ${arcSideLabel(mirror.side).toLowerCase()} arc to copy`
                  : `Replace these guns with the ${arcSideLabel(mirror.side).toLowerCase()} layout`
              }
              className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer disabled:text-gray-600 disabled:cursor-not-allowed"
            >
              Copy from {arcSideLabel(mirror.side).toLowerCase()}
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange([...guns, newGunProfile()])}
            className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
          >
            + Add guns
          </button>
        </div>
      </div>

      {guns.length === 0 ? (
        <p className="text-xs text-gray-600 italic mt-1">Nothing bears on this arc.</p>
      ) : (
        <div className="space-y-2 mt-2">
          {guns.map((profile, i) => {
            // The bands have to widen outwards or the inner one swallows the
            // next: a shot falls in the first band whose distance it is within.
            const ascending = RANGE_BANDS.every(
              (band, bi) => bi === 0 || profile.ranges[band] >= profile.ranges[RANGE_BANDS[bi - 1]],
            )
            return (
              <div key={profile.id} className="bg-gray-900/60 rounded p-2">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={profile.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    placeholder="24pdr"
                    className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    min={0}
                    value={profile.guns}
                    onChange={(e) => update(i, { guns: Math.max(0, Number(e.target.value)) })}
                    className="w-12 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-500">guns</span>
                  <button
                    type="button"
                    onClick={() => onChange(guns.filter((_, gi) => gi !== i))}
                    aria-label={`Remove ${profile.name || 'guns'} from the ${arcSideLabel(side).toLowerCase()} arc`}
                    className="text-gray-500 hover:text-red-400 px-1 cursor-pointer"
                  >
                    ×
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1 mt-1.5">
                  {RANGE_BANDS.map((band) => (
                    <label key={band} className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-gray-500">
                        {RANGE_BAND_LABELS[band]}
                        {band !== 'close' && ` ×${RANGE_BAND_MODIFIERS[band]}`}
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={profile.ranges[band]}
                        onChange={(e) => updateRange(i, band, Number(e.target.value))}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-1 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </label>
                  ))}
                </div>
                {!ascending && (
                  <p className="text-xs text-amber-500 mt-1">
                    Ranges should grow outwards; a band shorter than the one inside it never applies.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface UnitFormModalProps {
  unit?: Unit
  /**
   * Reference point (middle of the base's rear edge) in world coordinates,
   * pre-filled from a click on the battlefield.
   */
  defaultPosition?: { x: number; y: number }
  onSave: (unit: Unit) => void
  onClose: () => void
}

export function UnitFormModal({ unit, defaultPosition, onSave, onClose }: UnitFormModalProps) {
  const currentGame = useGameStore((s) => s.currentGame)
  const windDirection = currentGame?.windDirection ?? 0
  const [name, setName] = useState(unit?.name ?? '')
  const [side, setSide] = useState<UnitSide>(unit?.side ?? 'player')
  const [orientation, setOrientation] = useState(unit?.orientation ?? 0)
  const [status, setStatus] = useState<UnitStatus>(unit?.status ?? 'active')
  const [aiStyle, setAiStyle] = useState<AIStyle>(unit?.aiStyle ?? 'cautious')
  const [maxTurnPoints, setMaxTurnPoints] = useState(unit?.maxTurnPoints ?? 6)
  const [foreAndAftRigged, setForeAndAftRigged] = useState(unit?.foreAndAftRigged ?? false)
  const [arcGuns, setArcGuns] = useState<Record<ArcSide, GunProfile[]>>(() => {
    const result: Record<ArcSide, GunProfile[]> = { bow: [], stern: [], port: [], starboard: [] }
    for (const a of unit?.firingArcs ?? []) {
      result[a.side] = a.guns
    }
    return result
  })
  const defaultProfile: Record<Attitude, SpeedRange> = {
    // A ship head to wind makes no way of her own — she drifts, at the speed
    // below — so this is always 0 and is not offered for editing.
    in_irons: { max: 0 },
    beating: { max: 60 },
    reaching: { max: 100 },
    quarter_reaching: { max: 120 },
    running: { max: 110 },
  }
  const [driftSpeed, setDriftSpeed] = useState(unit?.driftSpeed ?? 10)
  const [baseWidth, setBaseWidth] = useState(unit?.baseWidth ?? 30)
  const [baseLength, setBaseLength] = useState(unit?.baseLength ?? 80)
  const [speedPercent, setSpeedPercent] = useState(() => speedMultiplierToPercent(unit?.speedMultiplier))
  const [speedProfile, setSpeedProfile] = useState<Record<Attitude, SpeedRange>>(
    unit?.speedProfile ?? defaultProfile,
  )

  const origin = currentGame ? originPoint(currentGame) : { x: 0, y: 0 }
  const anchorName = currentGame ? originName(currentGame) : null
  // The first entity on the table defines the origin, so it has nothing to be
  // offset from; an existing origin unit keeps reading (0, 0) by definition.
  const isFirstEntity = !currentGame?.originId
  const isOrigin = !!unit && currentGame?.originId === unit.id

  // A ship is placed by the middle of its base's rear edge — where a ruler is
  // held against the model — so that, and not the base centre, is what the form
  // edits. `Unit.position` (the centre) is derived from it on save, which means
  // changing the orientation pivots the model about its stern.
  const [offset, setOffset] = useState(() => {
    if (unit) {
      return toOffset(sternMidpoint(unit.position, unit.orientation, unit.baseLength), origin)
    }
    if (defaultPosition) return toOffset(defaultPosition, origin)
    return { east: 0, south: 0 }
  })

  const computedAttitude = computeAttitude(windDirection, orientation, foreAndAftRigged)
  const bestSpeed = Math.max(...SAILING_ATTITUDES.map((a) => speedProfile[a].max))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const reference =
      isFirstEntity || isOrigin
        ? (unit ? sternMidpoint(unit.position, unit.orientation, unit.baseLength) : { x: 0, y: 0 })
        : fromOffset(offset, origin)
    const center = centerFromSternMidpoint(reference, orientation, baseLength)
    onSave({
      id: unit?.id ?? uuid(),
      name: name.trim(),
      side,
      position: { x: Math.round(center.x), y: Math.round(center.y) },
      orientation,
      status,
      aiStyle: side === 'ai' ? aiStyle : 'cautious',
      maxTurnPoints,
      foreAndAftRigged,
      // In irons is never a sailing speed, whatever an older save may hold.
      speedProfile: { ...speedProfile, in_irons: { max: 0 } },
      speedMultiplier: speedMultiplierFromPercent(speedPercent),
      driftSpeed,
      baseWidth,
      baseLength,

      // Gun layouts are only entered for AI ships — the player rolls their own
      // fire — but anything already on the unit is kept, so flipping a ship to
      // the player's side and back does not throw its armament away.
      firingArcs: (Object.entries(arcGuns) as [ArcSide, GunProfile[]][])
        .filter(([, guns]) => guns.some((g) => g.guns > 0 && g.ranges.extreme > 0))
        .map(([side, guns]) => ({
          id: unit?.firingArcs.find((a) => a.side === side)?.id ?? uuid(),
          side,
          guns,
        })),
      attitude: computedAttitude,
      prevAttitude: computedAttitude,
      // No movement phase resolved yet: this turn's minimum comes from half
      // the maximum rather than half of a previous move.
      prevMoveDistance: unit?.prevMoveDistance ?? null,
      hiddenAIOrder: null,
      playerOrder: null,
      hiddenAIFirePlan: null,
      hiddenAIAction: null,
      lastFireChunks: unit?.lastFireChunks ?? {},
      isInIrons: false,
      // Grapple is a mutual relationship managed via the canvas unit panel
      // (setGrapple), not edited here — preserve whatever it currently is.
      grappledWith: unit?.grappledWith ?? null,
      // A tack in progress is movement state, not something the form edits.
      tackDirection: unit?.tackDirection ?? null,
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

          <div className="border-t border-b border-gray-800 py-3">
            {isFirstEntity || isOrigin ? (
              <p className="text-xs text-gray-500">
                {isOrigin
                  ? 'This ship is the coordinate origin — it reads (0, 0) wherever it sails, and everything else is measured from the middle of its stern.'
                  : 'This is the first thing on the table, so it becomes the coordinate origin. Everything placed afterwards is measured from the middle of its stern.'}
              </p>
            ) : (
              <>
                <p className="text-xs text-gray-400 mb-2">
                  Middle of the stern, measured from{' '}
                  <span className="text-gray-200">{anchorName ?? 'the origin'}</span>
                </p>
                <OffsetInput value={offset} onChange={setOffset} />
              </>
            )}
          </div>

          <OrientationSlider
            key={`${unit?.id ?? 'new'}-${foreAndAftRigged}`}
            initial={orientation}
            windDir={windDirection}
            foreAndAftRigged={foreAndAftRigged}
            onChange={(v) => setOrientation(v)}
          />

          <div>
            <label className="block text-xs text-gray-400 mb-1">Status</label>
            <Select<UnitStatus>
              value={status}
              onChange={setStatus}
              ariaLabel="Status"
              className="w-full"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'grappled', label: 'Grappled' },
                { value: 'immobilised', label: 'Immobilised' },
                { value: 'destroyed', label: 'Destroyed' },
                { value: 'surrendered', label: 'Surrendered' },
              ]}
            />
          </div>

          {side === 'ai' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">AI Style</label>
              <Select<AIStyle>
                value={aiStyle}
                onChange={setAiStyle}
                ariaLabel="AI style"
                className="w-full"
                options={[
                  { value: 'aggressive', label: 'Aggressive' },
                  { value: 'cautious', label: 'Cautious' },
                  { value: 'defensive', label: 'Defensive' },
                ]}
              />
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

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Rig</label>
            <div className="flex gap-2">
              {([false, true] as const).map((foreAft) => (
                <button
                  key={String(foreAft)}
                  type="button"
                  onClick={() => setForeAndAftRigged(foreAft)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    foreAndAftRigged === foreAft
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 border border-gray-700'
                  }`}
                >
                  {foreAft ? 'Fore & Aft' : 'Square'}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {foreAndAftRigged
                ? 'Points higher: in irons to 4 points off the wind, beating from 5.'
                : 'In irons to 5 points off the wind, beating from 6.'}
            </p>
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
              {SAILING_ATTITUDES.map((att) => (
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
            <p className="text-xs text-gray-500 mt-2">
              Best to worst. In irons is not listed: head to wind a ship carries no way of her own
              and drifts instead, at the speed below.
            </p>
            <div className="grid grid-cols-3 gap-1 items-center mt-2 pt-2 border-t border-gray-700/50">
              <span className="text-xs text-gray-300">Multiplier</span>
              <input
                type="number"
                min={0}
                step={1}
                value={speedPercent}
                onChange={(e) => setSpeedPercent(Math.max(0, Math.round(Number(e.target.value))))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-500">%</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Scales every figure above &mdash; 100% as entered, less for a ship shortened down,
              more for one under full sail. Her best point of sail comes out at{' '}
              <span className="text-gray-300">
                {Math.round((bestSpeed * speedPercent) / 100)}mm
              </span>
              .
            </p>
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

          {side === 'ai' && (
            <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 space-y-3">
              <div>
                <div className="text-xs text-gray-400 font-medium">Guns</div>
                <p className="text-xs text-gray-500 mt-0.5">
                  An arc can carry several kinds of gun, each reaching its own distances. Past close
                  range a shot is worth a fraction of itself &mdash;{' '}
                  {RANGE_BANDS.filter((b) => b !== 'close')
                    .map((b) => `${RANGE_BAND_LABELS[b].toLowerCase()} ×${RANGE_BAND_MODIFIERS[b]}`)
                    .join(', ')}{' '}
                  &mdash; which is what the AI weighs a shot by when it decides whether, and when in
                  the move, to fire.
                </p>
              </div>
              {ARC_SIDES.map((arcSide) => {
                // Port and starboard mirror each other; the bow and stern arcs
                // have no counterpart worth copying.
                const mirrorSide: ArcSide | undefined =
                  arcSide === 'port' ? 'starboard' : arcSide === 'starboard' ? 'port' : undefined
                return (
                  <ArcGunsEditor
                    key={arcSide}
                    side={arcSide}
                    guns={arcGuns[arcSide]}
                    onChange={(guns) => setArcGuns((prev) => ({ ...prev, [arcSide]: guns }))}
                    mirror={mirrorSide && { side: mirrorSide, guns: arcGuns[mirrorSide] }}
                  />
                )
              })}
            </div>
          )}

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
