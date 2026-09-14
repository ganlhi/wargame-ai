import { describe, it, expect, beforeEach } from 'vitest'
import type { ShipSettings } from '../types'
import { gunRanges } from '../data/binder'

// The store reaches for localStorage at import time (zustand `persist`), so a
// tiny in-memory stand-in keeps this in the default node environment.
class MemoryStorage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  key(i: number) { return [...this.data.keys()][i] ?? null }
  getItem(k: string) { return this.data.get(k) ?? null }
  setItem(k: string, v: string) { this.data.set(k, String(v)) }
  removeItem(k: string) { this.data.delete(k) }
  clear() { this.data.clear() }
}
globalThis.localStorage = new MemoryStorage() as unknown as Storage

const { useShipTemplateStore } = await import('./shipTemplateStore')
const { cloneShipSettings } = await import('../utils/shipTemplates')

const settings = (overrides: Partial<ShipSettings> = {}): ShipSettings => ({
  shipType: 'rate_3',
  foreAndAftRigged: false,
  speedMultiplier: 1,
  baseWidth: 30,
  baseLength: 80,
  firingArcs: [
    {
      id: 'arc-port',
      side: 'port',
      guns: [{ id: 'g1', type: 'long_24', guns: 14, ranges: gunRanges('long_24', '1/1200') }],
    },
  ],
  ...overrides,
})

describe('ship template store', () => {
  beforeEach(() => {
    useShipTemplateStore.setState({ templates: [] })
  })

  it('saves under a trimmed name, keeps the list alphabetical, and leaves game state out', () => {
    const store = useShipTemplateStore.getState()
    store.saveTemplate('  Sloop ', settings())
    store.saveTemplate('Frigate', settings())
    const names = useShipTemplateStore.getState().templates.map((t) => t.name)
    expect(names).toEqual(['Frigate', 'Sloop'])
    const sloop = useShipTemplateStore.getState().templates[1]
    expect(sloop).not.toHaveProperty('position')
    expect(sloop).not.toHaveProperty('side')
    expect(sloop.firingArcs[0].guns[0].guns).toBe(14)
  })

  it('replaces a template of the same name (ignoring case) in place, keeping its id', () => {
    const store = useShipTemplateStore.getState()
    const first = store.saveTemplate('Frigate', settings({ baseLength: 80 }))
    const second = store.saveTemplate('frigate', settings({ baseLength: 90 }))
    const { templates } = useShipTemplateStore.getState()
    expect(templates).toHaveLength(1)
    expect(second.id).toBe(first.id)
    expect(templates[0].baseLength).toBe(90)
    expect(templates[0].name).toBe('frigate')
  })

  it('edits a template by id, so renaming it does not touch a namesake or leave the old entry behind', () => {
    const store = useShipTemplateStore.getState()
    const frigate = store.saveTemplate('Frigate', settings({ baseLength: 80 }))
    store.saveTemplate('Sloop', settings())
    const renamed = store.saveTemplate('Heavy frigate', settings({ baseLength: 95 }), frigate.id)
    const { templates } = useShipTemplateStore.getState()
    expect(renamed.id).toBe(frigate.id)
    expect(templates.map((t) => t.name)).toEqual(['Heavy frigate', 'Sloop'])
    expect(templates[0].baseLength).toBe(95)
  })

  it('copies rather than shares the settings it is given', () => {
    const source = settings()
    useShipTemplateStore.getState().saveTemplate('Brig', source)
    source.firingArcs[0].guns[0].guns = 99
    expect(useShipTemplateStore.getState().templates[0].firingArcs[0].guns[0].guns).toBe(14)
  })

  it('removes by id and adopts a whole library', () => {
    const store = useShipTemplateStore.getState()
    const a = store.saveTemplate('A', settings())
    store.saveTemplate('B', settings())
    store.removeTemplate(a.id)
    expect(useShipTemplateStore.getState().templates.map((t) => t.name)).toEqual(['B'])
    store.replaceAll([
      { ...a, name: 'Zulu' },
      { ...a, id: 'other', name: 'Mike' },
    ])
    expect(useShipTemplateStore.getState().templates.map((t) => t.name)).toEqual(['Mike', 'Zulu'])
  })
})

describe('cloneShipSettings', () => {
  it('gives every arc and gun profile a fresh id so two ships from one template stay independent', () => {
    const source = settings()
    const clone = cloneShipSettings(source)
    expect(clone.firingArcs[0].id).not.toBe(source.firingArcs[0].id)
    expect(clone.firingArcs[0].guns[0].id).not.toBe(source.firingArcs[0].guns[0].id)
    expect(clone.firingArcs[0].guns[0].ranges).toEqual(source.firingArcs[0].guns[0].ranges)
    expect(clone.firingArcs[0].guns[0].ranges).not.toBe(source.firingArcs[0].guns[0].ranges)
  })
})
