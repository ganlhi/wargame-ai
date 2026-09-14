import { useState } from 'react'
import { useShipTemplateStore } from '../stores/shipTemplateStore'
import { deleteShipTemplate, saveShipTemplate } from '../sync/syncActions'
import { arcGunCount } from '../types'
import type { ShipTemplate } from '../types'
import { REFERENCE_SCALE, SHIP_TYPE_INFO } from '../data/binder'
import { speedMultiplierToPercent } from '../game/movement'
import { findTemplateByName } from '../utils/shipTemplates'
import { GunsFields, ShipSettingsFields } from './ShipSettingsFields'
import { draftFromSettings, settingsFromDraft } from '../utils/shipSettingsDraft'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The one line under a ship's name in the list: what she is, how she is
 * rigged, and what she carries. No speeds: those are the charts' to give, and
 * the charts are read against a game's scale and weather, which the library
 * knows nothing of.
 */
function summarise(t: ShipTemplate): string {
  const info = SHIP_TYPE_INFO[t.shipType]
  const guns = t.firingArcs.reduce((n, arc) => n + arcGunCount(arc), 0)
  const percent = speedMultiplierToPercent(t.speedMultiplier)
  return [
    info.label,
    t.foreAndAftRigged ? 'fore & aft' : 'square rig',
    `${info.turnPoints}pt turn`,
    guns > 0 ? plural(guns, 'gun') : 'no guns',
    ...(percent === 100 ? [] : [`${percent}% sail`]),
  ].join(' · ')
}

/**
 * Add or edit a saved ship: her name and everything that is hers whatever
 * game she is in, with the same fields the unit form uses. Guns are always
 * shown here — a class is defined once and may serve either side — where the
 * unit form only shows them for AI ships.
 */
function ShipTemplateFormModal({
  template,
  onClose,
}: {
  template?: ShipTemplate
  onClose: () => void
}) {
  const templates = useShipTemplateStore((s) => s.templates)
  const [name, setName] = useState(template?.name ?? '')
  const [draft, setDraft] = useState(() => draftFromSettings(template, REFERENCE_SCALE))
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Two saved ships must not share a name, or a pick from the list would be
  // ambiguous. The one being edited may of course keep hers.
  const clash = findTemplateByName(templates, name)
  const taken = !!clash && clash.id !== template?.id
  const canSave = !!name.trim() && !taken

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    saveShipTemplate(name, settingsFromDraft(draft, template?.firingArcs ?? []), template?.id)
    onClose()
  }

  const handleDelete = () => {
    if (!template) return
    deleteShipTemplate(template.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 mx-2 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold mb-1">{template ? 'Edit Saved Ship' : 'New Saved Ship'}</h2>
        <p className="text-xs text-gray-500 mb-4">
          What is saved is the ship's own: her type, rig, base and guns. Position, heading and
          side are set when she is added to a game &mdash; as are her speeds and ranges, which
          the rulebook gives against that game's scale and weather. The distances below are
          shown at {REFERENCE_SCALE} for comparison.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus={!template}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="74-gun third rate"
            />
            {taken && (
              <p className="text-xs text-amber-500 mt-1">
                A saved ship is already called {clash.name}.
              </p>
            )}
          </div>

          <ShipSettingsFields draft={draft} onChange={setDraft} />
          <GunsFields
            arcGuns={draft.arcGuns}
            scale={REFERENCE_SCALE}
            onChange={(arcGuns) => setDraft({ ...draft, arcGuns })}
          />

          <div className="flex gap-2 pt-2 items-center flex-wrap">
            <button
              type="submit"
              disabled={!canSave}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {template ? 'Save Changes' : 'Add Ship'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            {template &&
              (confirmDelete ? (
                <>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="text-red-400 hover:text-red-300 text-xs font-medium px-3 py-2 border border-red-800 rounded-lg transition-colors cursor-pointer"
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-gray-500 hover:text-gray-300 text-xs px-2 py-2 transition-colors cursor-pointer"
                  >
                    Keep
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  title="Remove this ship from the saved ships"
                  className="px-3 py-2 text-sm text-gray-500 hover:text-red-400 transition-colors cursor-pointer"
                >
                  Delete
                </button>
              ))}
          </div>
        </form>
      </div>
    </div>
  )
}

/** The saved ships on the home page: the library at a glance, with a form to add one or edit any of them. */
export function SavedShipsPanel() {
  const templates = useShipTemplateStore((s) => s.templates)
  // 'new' opens an empty form; an id opens that ship.
  const [editing, setEditing] = useState<string | null>(null)
  const editingTemplate = editing && editing !== 'new' ? templates.find((t) => t.id === editing) : undefined
  const showForm = editing === 'new' || !!editingTemplate

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold">Saved Ships</h2>
          {templates.length > 0 && (
            <span className="text-xs text-gray-500">{plural(templates.length, 'ship')}</span>
          )}
        </div>
        <button
          onClick={() => setEditing('new')}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
        >
          + New Ship
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-gray-800 rounded-xl">
          <div className="text-4xl mb-3 text-gray-600">⛵</div>
          <p className="text-gray-400 mb-1">No saved ships yet</p>
          <p className="text-sm text-gray-600">
            Define a class here, or save a ship's settings from the unit form, and adding her to
            a game is a single pick.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setEditing(t.id)}
                className="w-full text-left p-4 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors cursor-pointer"
              >
                <span className="font-medium text-gray-100">{t.name}</span>
                <div className="text-xs text-gray-500 mt-1">{summarise(t)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <ShipTemplateFormModal
          key={editing}
          template={editingTemplate}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}
