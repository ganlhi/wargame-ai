import { useState, useRef } from 'react'
import { v4 as uuid } from 'uuid'
import { useGameStore } from '../stores/gameStore'
import { useShipTemplateStore } from '../stores/shipTemplateStore'
import { deleteShipTemplate, saveShipTemplate } from '../sync/syncActions'
import { computeAttitude, ATTITUDE_LABELS, COMPASS_LABELS } from '../utils/attitude'
import type { Unit, UnitSide, AIStyle, UnitStatus, ShipSettings, ShipTemplate } from '../types'
import { cloneShipSettings, findTemplateByName } from '../utils/shipTemplates'
import { REFERENCE_SCALE } from '../data/binder'
import { conditionsOf, shipStats } from '../game/shipStats'
import { BearingInput } from './BearingInput'
import { Select } from './Select'
import { GunsFields, ShipSettingsFields } from './ShipSettingsFields'
import { draftFromSettings, settingsFromDraft } from '../utils/shipSettingsDraft'
import { fromBearing, originName, originPoint, toBearing } from '../utils/coordinates'

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
      <label className="block text-xs text-gray-400 mb-1">Heading</label>
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

/**
 * The library of saved ships, from inside the unit form: import one to fill
 * the settings in instead of typing them, or save what is on the form now
 * under a name so the next ship of her class is a single pick. The library
 * itself is managed from the home page.
 */
function SavedShipsSection({
  shipName,
  settings,
  onImport,
}: {
  /** The name on the form, offered as the default name to save under. */
  shipName: string
  /** What the form currently holds, which is what gets saved. */
  settings: ShipSettings
  onImport: (template: ShipTemplate) => void
}) {
  const templates = useShipTemplateStore((s) => s.templates)
  const [selectedId, setSelectedId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const selected = templates.find((t) => t.id === selectedId)
  const overwrites = saving ? findTemplateByName(templates, saveName) : undefined

  const startSaving = () => {
    setSaveName(shipName.trim())
    setSaving(true)
    setNotice(null)
  }

  const commitSave = () => {
    if (!saveName.trim()) return
    const saved = saveShipTemplate(saveName, settings)
    setSaving(false)
    setSelectedId(saved.id)
    setNotice(`Saved as ${saved.name}.`)
  }

  const handleImport = (id: string) => {
    const template = templates.find((t) => t.id === id)
    if (!template) return
    setSelectedId(id)
    setSaving(false)
    onImport(template)
    setNotice(`Settings taken from ${template.name}. Position, heading and side are yours to set.`)
  }

  const handleRemove = () => {
    if (!selected) return
    deleteShipTemplate(selected.id)
    setSelectedId('')
    setNotice(`${selected.name} removed from the saved ships.`)
  }

  const inputClass =
    'flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500'
  const linkClass = 'text-xs text-blue-400 hover:text-blue-300 cursor-pointer whitespace-nowrap'

  return (
    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400 font-medium">Saved ships</span>
        {!saving && (
          <button type="button" onClick={startSaving} className={linkClass}>
            Save these settings
          </button>
        )}
      </div>

      {templates.length > 0 ? (
        <div className="flex items-center gap-2">
          <Select<string>
            value={selectedId}
            onChange={handleImport}
            placeholder="Import a saved ship…"
            ariaLabel="Import a saved ship"
            size="sm"
            className="flex-1 min-w-0"
            options={templates.map((t) => ({ value: t.id, label: t.name }))}
          />
          {selected && (
            <button
              type="button"
              onClick={handleRemove}
              title={`Remove ${selected.name} from the saved ships`}
              className="text-xs text-gray-500 hover:text-red-400 cursor-pointer whitespace-nowrap"
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        !saving && (
          <p className="text-xs text-gray-600 italic">
            None yet. Save a ship's settings here and the next one of her class is a single pick.
          </p>
        )
      )}

      {saving && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                // Enter here names the template; it must not submit the unit.
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitSave()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setSaving(false)
                }
              }}
              placeholder="74-gun third rate"
              autoFocus
              className={inputClass}
            />
            <button
              type="button"
              onClick={commitSave}
              disabled={!saveName.trim()}
              className="text-xs font-medium px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {overwrites ? 'Replace' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setSaving(false)}
              className="text-xs text-gray-400 hover:text-gray-200 px-1 cursor-pointer"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {overwrites
              ? `A saved ship is already called ${overwrites.name}; saving replaces its settings.`
              : 'Rig, turning, speeds, base and guns are saved. Position, heading, side and status are not.'}
          </p>
        </div>
      )}

      {notice && !saving && <p className="text-xs text-gray-500">{notice}</p>}
    </div>
  )
}

interface UnitFormModalProps {
  unit?: Unit
  /**
   * Base centre in world coordinates, pre-filled from a tap on the battlefield.
   * It is read into the form as a bearing, so it lands rounded to the rose.
   */
  defaultPosition?: { x: number; y: number }
  onSave: (unit: Unit) => void
  onClose: () => void
}

export function UnitFormModal({ unit, defaultPosition, onSave, onClose }: UnitFormModalProps) {
  const currentGame = useGameStore((s) => s.currentGame)
  const windDirection = currentGame?.windDirection ?? 0
  // The unit form only ever opens inside a game, so the scale and weather her
  // speeds and ranges are read against are always to hand.
  const conditions = conditionsOf(
    currentGame ?? { scale: REFERENCE_SCALE, windStrength: 'moderate_breeze', windDirection: 0 },
  )
  const [name, setName] = useState(unit?.name ?? '')
  const [side, setSide] = useState<UnitSide>(unit?.side ?? 'player')
  const [orientation, setOrientation] = useState(unit?.orientation ?? 0)
  const [status, setStatus] = useState<UnitStatus>(unit?.status ?? 'active')
  const [aiStyle, setAiStyle] = useState<AIStyle>(unit?.aiStyle ?? 'cautious')
  // Everything that is the ship's own — what a saved ship holds — in one draft.
  const [draft, setDraft] = useState(() => draftFromSettings(unit, conditions.scale))

  const origin = currentGame ? originPoint(currentGame) : { x: 0, y: 0 }
  const anchorName = currentGame ? originName(currentGame) : null
  // The first ship on the table becomes the origin, so she has nothing to be
  // measured from; an existing origin ship keeps reading *origin* by definition.
  const isFirstShip = !currentGame?.originId
  const isOrigin = !!unit && currentGame?.originId === unit.id

  // A ship is placed by the centre of her base, as a bearing from the origin
  // ship — the reading a player takes across the table.
  const [bearing, setBearing] = useState(() => {
    if (unit) return toBearing(unit.position, origin)
    if (defaultPosition) return toBearing(defaultPosition, origin)
    return { direction: 0, distance: 0 }
  })

  const computedAttitude = computeAttitude(windDirection, orientation, draft.foreAndAftRigged)
  const currentSettings = settingsFromDraft(draft, unit?.firingArcs ?? [])

  // Fill the form from a saved ship. A blank name takes the template's, so a
  // new ship of a named class is one pick away; a ship already named keeps
  // hers, since importing a class is not renaming her.
  const importTemplate = (template: ShipTemplate) => {
    if (!name.trim()) setName(template.name)
    setDraft(draftFromSettings(cloneShipSettings(template), conditions.scale))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    // The origin ship is wherever she is — she reads *origin* by definition —
    // and the very first ship is put at the world origin, since nothing else
    // exists yet to measure her from.
    const center =
      isFirstShip ? { x: 0, y: 0 }
      : isOrigin && unit ? unit.position
      : fromBearing(bearing, origin)
    onSave({
      id: unit?.id ?? uuid(),
      name: name.trim(),
      side,
      position: { x: Math.round(center.x), y: Math.round(center.y) },
      orientation,
      status,
      aiStyle: side === 'ai' ? aiStyle : 'cautious',
      ...currentSettings,
      // Speeds, drift and turning are the charts', read off her type against
      // this game's scale and weather rather than entered anywhere.
      ...shipStats(currentSettings.shipType, conditions),
      attitude: computedAttitude,
      isInIrons: computedAttitude === 'in_irons',
      // What the AI remembers of its own last order is not the form's to edit.
      prevAttitude: unit?.prevAttitude ?? null,
      prevMoveDistance: unit?.prevMoveDistance ?? null,
      tackDirection: unit?.tackDirection ?? null,
      aiOrder: null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 mx-2 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold mb-4">{unit ? 'Edit Ship' : 'New Ship'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3.5">

          <SavedShipsSection shipName={name} settings={currentSettings} onImport={importTemplate} />

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
            {isFirstShip || isOrigin ? (
              <p className="text-xs text-gray-500">
                {isOrigin
                  ? 'This ship is the origin: she reads origin wherever she sails, and every other position is a bearing from the centre of her base.'
                  : 'This is the first ship on the table, so she becomes the origin. Everything placed afterwards is a bearing from the centre of her base.'}
              </p>
            ) : (
              <>
                <p className="text-xs text-gray-400 mb-2">
                  Centre of the base, from{' '}
                  <span className="text-gray-200">{anchorName ?? 'the origin ship'}</span>
                </p>
                <BearingInput value={bearing} onChange={setBearing} />
              </>
            )}
          </div>

          <OrientationSlider
            key={`${unit?.id ?? 'new'}-${draft.foreAndAftRigged}`}
            initial={orientation}
            windDir={windDirection}
            foreAndAftRigged={draft.foreAndAftRigged}
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

          <ShipSettingsFields draft={draft} onChange={setDraft} conditions={conditions} />

          {/* Every ship carries her guns, the player's included: the AI
              judges how dangerous an enemy is by what she mounts. */}
          <GunsFields
            arcGuns={draft.arcGuns}
            scale={conditions.scale}
            onChange={(arcGuns) => setDraft({ ...draft, arcGuns })}
          />

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {unit ? 'Save Changes' : 'Add Ship'}
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
