import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'
import type { ShipSettings, ShipTemplate } from '../types'
import { findTemplateByName, shipSettingsOf, sortTemplates } from '../utils/shipTemplates'
import { normaliseShipTemplate } from './migrations'

/**
 * The library of saved ships. It lives beside the games rather than inside
 * any one of them: a 74 typed in for one scenario is the same 74 in the next.
 */
interface ShipTemplateStore {
  templates: ShipTemplate[]

  /**
   * Save settings under a name. A template already bearing that name (ignoring
   * case and surrounding space) is updated in place, keeping its id; otherwise
   * a new one is added. Returns the template as saved.
   */
  saveTemplate: (name: string, settings: ShipSettings) => ShipTemplate
  removeTemplate: (id: string) => void
  /** Adopt a whole library, as when Drive is the source of truth. */
  replaceAll: (templates: ShipTemplate[]) => void
}

export const useShipTemplateStore = create<ShipTemplateStore>()(
  persist(
    (set, get) => ({
      templates: [],

      saveTemplate: (name, settings) => {
        const trimmed = name.trim()
        const timestamp = new Date().toISOString()
        const existing = findTemplateByName(get().templates, trimmed)
        const template: ShipTemplate = {
          id: existing?.id ?? uuid(),
          name: trimmed,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
          ...shipSettingsOf(settings),
        }
        set((state) => ({
          templates: sortTemplates(
            existing
              ? state.templates.map((t) => (t.id === existing.id ? template : t))
              : [...state.templates, template],
          ),
        }))
        return template
      },

      removeTemplate: (id) =>
        set((state) => ({ templates: state.templates.filter((t) => t.id !== id) })),

      replaceAll: (templates) => set({ templates: sortTemplates(templates) }),
    }),
    {
      name: 'wargame-ai-ship-templates',
      partialize: (state) => ({ templates: state.templates }),
      // Whatever an older build wrote is brought up to the current field set
      // before it reaches the form.
      merge: (persisted, current) => {
        const raw = (persisted as { templates?: unknown } | undefined)?.templates
        const templates = Array.isArray(raw)
          ? raw.map(normaliseShipTemplate).filter((t): t is ShipTemplate => t !== null)
          : []
        return { ...current, templates: sortTemplates(templates) }
      },
    },
  ),
)
