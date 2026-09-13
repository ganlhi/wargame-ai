import { v4 as uuid } from 'uuid'
import { ATTITUDE_LABELS, SAILING_ATTITUDES } from '../utils/attitude'
import { ARC_SIDES, RANGE_BANDS, RANGE_BAND_LABELS, RANGE_BAND_MODIFIERS, arcSideLabel } from '../types'
import type { ArcSide, GunProfile, RangeBand } from '../types'
import type { ShipSettingsDraft } from '../utils/shipSettingsDraft'

function newGunProfile(): GunProfile {
  return {
    id: uuid(),
    name: 'Guns',
    guns: 10,
    ranges: { close: 100, medium: 200, long: 300, extreme: 400 },
  }
}

const field =
  'w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500'
const smallField =
  'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500'

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

/** The gun layout, arc by arc. */
export function GunsFields({
  arcGuns,
  onChange,
}: {
  arcGuns: Record<ArcSide, GunProfile[]>
  onChange: (arcGuns: Record<ArcSide, GunProfile[]>) => void
}) {
  return (
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
        // Port and starboard mirror each other; the bow and stern arcs have no
        // counterpart worth copying.
        const mirrorSide: ArcSide | undefined =
          arcSide === 'port' ? 'starboard' : arcSide === 'starboard' ? 'port' : undefined
        return (
          <ArcGunsEditor
            key={arcSide}
            side={arcSide}
            guns={arcGuns[arcSide]}
            onChange={(guns) => onChange({ ...arcGuns, [arcSide]: guns })}
            mirror={mirrorSide && { side: mirrorSide, guns: arcGuns[mirrorSide] }}
          />
        )
      })}
    </div>
  )
}

/**
 * The fields for what is a ship's own whatever game she is in — her turning,
 * rig, base, speeds and drift. Shared by the unit form and the saved-ship
 * form, so a class is edited the same way wherever it is met. Guns are a
 * separate block ({@link GunsFields}) because the unit form only shows them
 * for AI ships.
 */
export function ShipSettingsFields({
  draft,
  onChange,
}: {
  draft: ShipSettingsDraft
  onChange: (draft: ShipSettingsDraft) => void
}) {
  const patch = (changes: Partial<ShipSettingsDraft>) => onChange({ ...draft, ...changes })
  const bestSpeed = Math.max(...SAILING_ATTITUDES.map((a) => draft.speedProfile[a].max))

  return (
    <>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Max Turn Points</label>
        <input
          type="number"
          min={0}
          max={32}
          value={draft.maxTurnPoints}
          onChange={(e) => patch({ maxTurnPoints: Number(e.target.value) })}
          className={field}
        />
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

      <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
        <div className="text-xs text-gray-400 font-medium mb-2">Max Speed per Attitude (mm/turn)</div>
        <div className="space-y-1.5">
          {SAILING_ATTITUDES.map((att) => (
            <div key={att} className="grid grid-cols-3 gap-1 items-center">
              <span className="text-xs text-gray-300">{ATTITUDE_LABELS[att]}</span>
              <input
                type="number"
                min={0}
                value={draft.speedProfile[att].max}
                onChange={(e) =>
                  patch({
                    speedProfile: {
                      ...draft.speedProfile,
                      [att]: { max: Math.max(0, Number(e.target.value)) },
                    },
                  })
                }
                className={smallField}
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
            value={draft.speedPercent}
            onChange={(e) => patch({ speedPercent: Math.max(0, Math.round(Number(e.target.value))) })}
            className={smallField}
          />
          <span className="text-xs text-gray-500">%</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Scales every figure above &mdash; 100% as entered, less for a ship shortened down,
          more for one under full sail. Her best point of sail comes out at{' '}
          <span className="text-gray-300">{Math.round((bestSpeed * draft.speedPercent) / 100)}mm</span>.
        </p>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Drift Speed (mm/chunk, when in irons)</label>
        <input
          type="number"
          min={0}
          value={draft.driftSpeed}
          onChange={(e) => patch({ driftSpeed: Math.max(0, Number(e.target.value)) })}
          className={field}
        />
      </div>
    </>
  )
}
