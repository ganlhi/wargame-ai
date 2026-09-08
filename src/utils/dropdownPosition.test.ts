import { describe, it, expect } from 'vitest'
import { computeDropdownPosition } from './dropdownPosition'

const VIEW_W = 390
const VIEW_H = 844

/** A trigger of the given height with its top at `top`. */
const trigger = (top: number, { left = 20, width = 160, height = 32 } = {}) => ({
  top,
  bottom: top + height,
  left,
  width,
})

describe('computeDropdownPosition', () => {
  it('opens below the trigger when there is room', () => {
    const p = computeDropdownPosition(trigger(100), VIEW_W, VIEW_H)
    expect(p.top).toBe(136) // 100 + 32 + 4 gap
    expect(p.bottom).toBeUndefined()
  })

  it('flips above when the trigger is near the bottom', () => {
    const p = computeDropdownPosition(trigger(VIEW_H - 60), VIEW_W, VIEW_H)
    expect(p.top).toBeUndefined()
    // Sits just above the trigger's top edge.
    expect(p.bottom).toBe(VIEW_H - (VIEW_H - 60) + 4)
  })

  it('stays below when neither side has much room, preferring the roomier one', () => {
    // Trigger dead centre: plenty below, so it opens downward.
    const p = computeDropdownPosition(trigger(VIEW_H / 2), VIEW_W, VIEW_H)
    expect(p.top).toBeDefined()
  })

  it('opens downward at the very top of the screen even though room below is tight', () => {
    // A short viewport: little room either way, but above is worse.
    const p = computeDropdownPosition(trigger(4), VIEW_W, 200)
    expect(p.top).toBeDefined()
    expect(p.bottom).toBeUndefined()
  })

  it('never squeezes the list below a usable height', () => {
    const cramped = computeDropdownPosition(trigger(90), VIEW_W, 160)
    expect(cramped.maxHeight).toBeGreaterThanOrEqual(96)
  })

  it('caps the list height so it cannot fill a tall screen', () => {
    expect(computeDropdownPosition(trigger(0), VIEW_W, 2000).maxHeight).toBe(280)
  })

  it('is at least as wide as the trigger and never runs off the right edge', () => {
    const p = computeDropdownPosition(trigger(100, { left: 300, width: 60 }), VIEW_W, VIEW_H)
    expect(p.width).toBe(60)
    expect(p.left + p.maxWidth).toBeLessThanOrEqual(VIEW_W)
    expect(p.maxWidth).toBeGreaterThanOrEqual(p.width)
  })

  it('keeps a trigger wider than the remaining space from collapsing', () => {
    // A wide trigger pushed right: maxWidth must not fall below the trigger width.
    const p = computeDropdownPosition(trigger(100, { left: 380, width: 200 }), VIEW_W, VIEW_H)
    expect(p.maxWidth).toBe(200)
  })
})
