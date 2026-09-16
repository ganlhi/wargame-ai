import { v4 as uuid } from 'uuid'
import { ATTITUDE_LABELS, SAILING_ATTITUDES } from '../utils/attitude'
import {
  ARC_SIDES, GUN_TYPES, RANGE_BANDS, RANGE_BAND_LABELS, RANGE_BAND_MODIFIERS, SHIP_TYPES,
  arcSideLabel,
} from '../types'
import type { ArcSide, GunProfile, GunType, Scale } from '../types'
import {
  DEFAULT_GUN_TYPE, GUN_TYPE_LABELS, SHIP_TYPE_INFO, WIND_STRENGTH_LABELS, gunRanges,
} from '../data/binder'
import type { Conditions } from '../game/shipStats'
import { shipStats } from '../game/shipStats'
import type { ShipSettingsDraft } from '../utils/shipSettingsDraft'
import { Select } from './Select'

function newGunProfile(scale: Scale): GunProfile {
  return { id: uuid(), type: DEFAULT_GUN_TYPE, guns: 10, ranges: gunRanges(DEFAULT_GUN_TYPE, scale) }
}

const GUN_OPTIONS = GUN_TYPES.map((type) => ({ value: type, label: GUN_TYPE_LABELS[type] }))
const SHIP_TYPE_OPTIONS = SHIP_TYPES.map((type) => ({ value: type, label: SHIP_TYPE_INFO[type].label }))

const field =
  'w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500'
const smallField =
  'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500'

/**
 * The guns in one arc. A ship rarely has a uniform broadside — long guns on the
 * gun deck, carronades above — so an arc is a list rather than a single entry;
 * each is a gun out of the rulebook's charts and a number of them, and the
 * distances it reaches follow from that and the game's scale.
 */
function ArcGunsEditor({
  side,
  guns,
  onChange,
  scale,
  mirror,
}: {
  side: ArcSide
  guns: GunProfile[]
  onChange: (guns: GunProfile[]) => void
  /** The scale the ranges shown are read at. */
  scale: Scale
  /**
   * The opposite broadside, when this arc has one. Ships almost always carry the
   * same guns on both sides, so the second broadside is entered by copying the
   * first rather than typing it twice.
   */
  mirror?: { side: ArcSide; guns: GunProfile[] }
}) {
  const update = (index: number, patch: Partial<GunProfile>) =>
    onChange(guns.map((g, i) => (i === index ? { ...g, ...patch } : g)))

  const setType = (index: number, type: GunType) =>
    update(index, { type, ranges: gunRanges(type, scale) })

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
            onClick={() => onChange([...guns, newGunProfile(scale)])}
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
            const ranges = gunRanges(profile.type, scale)
            return (
              <div key={profile.id} className="bg-gray-900/60 rounded p-2">
                <div className="flex items-center gap-1.5">
                  <Select<GunType>
                    value={profile.type}
                    onChange={(type) => setType(i, type)}
                    ariaLabel={`Gun in the ${arcSideLabel(side).toLowerCase()} arc`}
                    size="sm"
                    className="flex-1 min-w-0"
                    options={GUN_OPTIONS}
                  />
                  <input
                    type="number"
                    min={0}
                    value={profile.guns}
                    aria-label={`Number of ${GUN_TYPE_LABELS[profile.type]} in the ${arcSideLabel(side).toLowerCase()} arc`}
                    onChange={(e) => update(i, { guns: Math.max(0, Number(e.target.value)) })}
                    className="w-12 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-500">guns</span>
                  <button
                    type="button"
                    onClick={() => onChange(guns.filter((_, gi) => gi !== i))}
                    aria-label={`Remove ${GUN_TYPE_LABELS[profile.type]} from the ${arcSideLabel(side).toLowerCase()} arc`}
                    className="text-gray-500 hover:text-red-400 px-1 cursor-pointer"
                  >
                    ×
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5">
                  {RANGE_BANDS.map((band) => (
                    <span key={band} className="text-[10px] text-gray-500">
                      {RANGE_BAND_LABELS[band]}{' '}
                      <span className="text-gray-400">{ranges[band]}mm</span>
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The gun layout, arc by arc. */
export function GunsFields({
  arcGuns,
  onChange,
  scale,
}: {
  arcGuns: Record<ArcSide, GunProfile[]>
  onChange: (arcGuns: Record<ArcSide, GunProfile[]>) => void
  /** The scale the ranges shown are read at. */
  scale: Scale
}) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 space-y-3">
      <div>
        <div className="text-xs text-gray-400 font-medium">Guns</div>
        <p className="text-xs text-gray-500 mt-0.5">
          Pick the gun and say how many; the distances below are the rulebook's, at {scale}.
          What a shot is worth falls away with the range &mdash;{' '}
          {RANGE_BANDS.map((b) => `${RANGE_BAND_LABELS[b].toLowerCase()} ×${RANGE_BAND_MODIFIERS[b]}`)
            .join(', ')}{' '}
          &mdash; which is what the AI weighs a position by. Every ship carries her guns, the
          player's included: they are how the AI judges how dangerous she is.
        </p>
      </div>
      {ARC_SIDES.map((arcSide) => {
        // Port and starboard mirror each other; the bow and stern arcs have no
        // counterpart worth copying.
        const mirrorSide: ArcSide | undefined =
          arcSide === 'port' ? 'starboard' : arcSide === 'starboard' ? 'port' : undefined
        return (
          <ArcGunsEditor
            key={arcSide}
            side={arcSide}
            guns={arcGuns[arcSide]}
            scale={scale}
            onChange={(guns) => onChange({ ...arcGuns, [arcSide]: guns })}
            mirror={mirrorSide && { side: mirrorSide, guns: arcGuns[mirrorSide] }}
          />
        )
      })}
    </div>
  )
}

/**
 * What the charts give this ship in this game: her speed on every point of
 * sail, her drift and her turning. Read-only — the whole point of choosing a
 * type is that these are not typed in — but worth showing, since they are what
 * the movement panel will hold her to.
 */
function ChartedFigures({
  draft,
  conditions,
}: {
  draft: ShipSettingsDraft
  conditions: Conditions
}) {
  const stats = shipStats(draft.shipType, conditions)
  const scaled = (max: number) => Math.round((max * draft.speedPercent) / 100)

  return (
    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
      <div className="text-xs text-gray-400 font-medium">
        From the charts &mdash; {conditions.scale},{' '}
        {WIND_STRENGTH_LABELS[conditions.windStrength].toLowerCase()}
      </div>
      <div className="space-y-1 mt-2">
        {SAILING_ATTITUDES.map((att) => (
          <div key={att} className="flex justify-between gap-2 text-xs">
            <span className="text-gray-300">{ATTITUDE_LABELS[att]}</span>
            <span className="text-gray-400">
              {scaled(stats.speedProfile[att].max)}mm
              {draft.speedPercent !== 100 && (
                <span className="text-gray-600"> of {stats.speedProfile[att].max}</span>
              )}
            </span>
          </div>
        ))}
        <div className="flex justify-between gap-2 text-xs pt-1 border-t border-gray-700/50">
          <span className="text-gray-300">Drifting, with no way on</span>
          <span className="text-gray-400">{stats.driftSpeed}mm</span>
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        Millimetres for a whole turn, best point of sail first. In irons is not listed: head to
        wind she carries no way of her own and drifts instead.
      </p>
    </div>
  )
}

/**
 * The fields for what is a ship's own whatever game she is in — her type, rig,
 * base and how hard she is being worked. Shared by the unit form and the
 * saved-ship form, so a class is edited the same way wherever it is met. Guns
 * are a separate block ({@link GunsFields}) so each form can place them.
 *
 * `conditions` is the game she is in, when she is in one. The library on the
 * home page belongs to no game, so there her speeds cannot be quoted — only
 * her turning, which the charts give by type alone.
 */
export function ShipSettingsFields({
  draft,
  onChange,
  conditions,
}: {
  draft: ShipSettingsDraft
  onChange: (draft: ShipSettingsDraft) => void
  conditions?: Conditions
}) {
  const patch = (changes: Partial<ShipSettingsDraft>) => onChange({ ...draft, ...changes })
  const turnPoints = SHIP_TYPE_INFO[draft.shipType].turnPoints

  return (
    <>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Type</label>
        <Select
          value={draft.shipType}
          onChange={(shipType) => patch({ shipType })}
          ariaLabel="Ship type"
          className="w-full"
          options={SHIP_TYPE_OPTIONS}
        />
        <p className="text-xs text-gray-500 mt-1">
          How she sails follows from this: her speeds and her drift come from the rulebook's
          charts, and she may turn{' '}
          <span className="text-gray-300">
            {turnPoints} point{turnPoints === 1 ? '' : 's'}
          </span>{' '}
          in a turn.
        </p>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Rig</label>
        <div className="flex gap-2">
          {([false, true] as const).map((foreAft) => (
            <button
              key={String(foreAft)}
              type="button"
              onClick={() => patch({ foreAndAftRigged: foreAft })}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                draft.foreAndAftRigged === foreAft
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 border border-gray-700'
              }`}
            >
              {foreAft ? 'Fore & Aft' : 'Square'}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {draft.foreAndAftRigged
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
            value={draft.baseWidth}
            onChange={(e) => patch({ baseWidth: Math.max(0, Number(e.target.value)) })}
            className={field}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Base Length (mm)</label>
          <input
            type="number"
            min={0}
            value={draft.baseLength}
            onChange={(e) => patch({ baseLength: Math.max(0, Number(e.target.value)) })}
            className={field}
          />
        </div>
      </div>
      <p className="text-xs text-gray-500 -mt-1.5">
        Footprint of the model's base. The AI won't let its base overlap another ship's.
      </p>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Sail set (%)</label>
        <input
          type="number"
          min={0}
          step={1}
          value={draft.speedPercent}
          onChange={(e) => patch({ speedPercent: Math.max(0, Math.round(Number(e.target.value))) })}
          className={smallField}
        />
        <p className="text-xs text-gray-500 mt-1">
          Scales every speed the charts give her &mdash; 100% as charted, less for a ship
          shortened down, more for one under full sail.
        </p>
      </div>

      {conditions && <ChartedFigures draft={draft} conditions={conditions} />}
    </>
  )
}
