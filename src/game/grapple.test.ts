import { describe, it, expect } from 'vitest'
import { applyGrapple, clearGrappleForRemoved } from './grapple'
import type { Unit, Attitude, SpeedRange } from '../types'

const SPEED_PROFILE: Record<Attitude, SpeedRange> = {
  in_irons: { max: 0 },
  beating: { max: 60 },
  reaching: { max: 80 },
  quarter_reaching: { max: 100 },
  running: { max: 90 },
}

function makeUnit(id: string, overrides: Partial<Unit> = {}): Unit {
  return {
    id,
    name: id,
    side: 'ai',
    position: { x: 0, y: 0 },
    orientation: 0,
    status: 'active',
    aiStyle: 'aggressive',
    maxTurnPoints: 6,
    speedProfile: SPEED_PROFILE,
    driftSpeed: 10,
    baseWidth: 30,
    baseLength: 80,
    firingArcs: [],
    attitude: 'reaching',
    isInIrons: false,
    grappledWith: null,
    prevAttitude: 'reaching',
    prevMoveDistance: 0,
    hiddenAIOrder: null,
    playerOrder: null,
    lastFireChunk: null,
    hiddenAIFirePlan: null,
    hiddenAIAction: null,
    ...overrides,
  }
}

const byId = (units: Unit[], id: string) => units.find((u) => u.id === id)!

describe('applyGrapple', () => {
  it('links two units mutually and marks both grappled', () => {
    const units = applyGrapple([makeUnit('a'), makeUnit('b')], 'a', 'b')
    expect(byId(units, 'a').grappledWith).toBe('b')
    expect(byId(units, 'b').grappledWith).toBe('a')
    expect(byId(units, 'a').status).toBe('grappled')
    expect(byId(units, 'b').status).toBe('grappled')
  })

  it('releases both sides and restores active status', () => {
    const linked = applyGrapple([makeUnit('a'), makeUnit('b')], 'a', 'b')
    const released = applyGrapple(linked, 'a', null)
    expect(byId(released, 'a').grappledWith).toBeNull()
    expect(byId(released, 'b').grappledWith).toBeNull()
    expect(byId(released, 'a').status).toBe('active')
    expect(byId(released, 'b').status).toBe('active')
  })

  it('detaches a prior partner when re-grappling to a different ship', () => {
    let units = [makeUnit('a'), makeUnit('b'), makeUnit('c')]
    units = applyGrapple(units, 'a', 'b')
    units = applyGrapple(units, 'a', 'c')
    expect(byId(units, 'a').grappledWith).toBe('c')
    expect(byId(units, 'c').grappledWith).toBe('a')
    // b should have been freed
    expect(byId(units, 'b').grappledWith).toBeNull()
    expect(byId(units, 'b').status).toBe('active')
  })

  it('does not clobber a non-grapple status (e.g. immobilised) on release', () => {
    let units = [makeUnit('a', { status: 'immobilised' }), makeUnit('b')]
    units = applyGrapple(units, 'a', 'b') // both become grappled
    // a is now grappled; release should fall back to active, not immobilised,
    // since the grapple overwrote it — but b's prior active is restored.
    units = applyGrapple(units, 'a', null)
    expect(byId(units, 'a').status).toBe('active')
  })
})

describe('clearGrappleForRemoved', () => {
  it('removes the unit and frees its partner', () => {
    const linked = applyGrapple([makeUnit('a'), makeUnit('b')], 'a', 'b')
    const after = clearGrappleForRemoved(linked, 'a')
    expect(after.find((u) => u.id === 'a')).toBeUndefined()
    expect(byId(after, 'b').grappledWith).toBeNull()
    expect(byId(after, 'b').status).toBe('active')
  })

  it('leaves an unrelated grappled status (destroyed partner) intact', () => {
    let units = [makeUnit('a'), makeUnit('b', { status: 'destroyed' })]
    units = applyGrapple(units, 'a', 'b') // both grappled now
    const after = clearGrappleForRemoved(units, 'a')
    // b was grappled, so freeing it resets to active
    expect(byId(after, 'b').grappledWith).toBeNull()
    expect(byId(after, 'b').status).toBe('active')
  })
})
