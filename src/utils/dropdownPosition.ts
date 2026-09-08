/** Gap between a dropdown trigger and its list, and between the list and the viewport edge. */
const GAP = 4
const EDGE = 8
/** With less room than this underneath, the list flips above the trigger. */
const MIN_ROOM_BELOW = 140
const MAX_LIST_HEIGHT = 280
/** Never squeeze the list below this, even in a tight spot — it scrolls instead. */
const MIN_LIST_HEIGHT = 96

export interface DropdownPosition {
  left: number
  width: number
  maxWidth: number
  maxHeight: number
  /** Exactly one of these is set, depending on which way the list opens. */
  top?: number
  bottom?: number
}

export interface TriggerRect {
  top: number
  bottom: number
  left: number
  width: number
}

/**
 * Where to put a dropdown list, given its trigger's viewport rect.
 *
 * The viewport size is a parameter rather than read from `window` so the
 * flipping and clamping are testable without a DOM. Coordinates are viewport
 * coordinates, to be used with `position: fixed` on a body-level portal — which
 * is what keeps the list anchored to its trigger regardless of any transformed
 * or overflow-clipping ancestor.
 */
export function computeDropdownPosition(
  rect: TriggerRect,
  viewportWidth: number,
  viewportHeight: number,
): DropdownPosition {
  const roomBelow = viewportHeight - rect.bottom - EDGE
  const roomAbove = rect.top - EDGE
  const openUp = roomBelow < MIN_ROOM_BELOW && roomAbove > roomBelow
  const room = openUp ? roomAbove : roomBelow

  return {
    left: rect.left,
    width: rect.width,
    // Let a long option run wider than the trigger, but never off the screen.
    maxWidth: Math.max(rect.width, viewportWidth - rect.left - EDGE),
    maxHeight: Math.min(MAX_LIST_HEIGHT, Math.max(MIN_LIST_HEIGHT, room)),
    ...(openUp
      ? { bottom: viewportHeight - rect.top + GAP }
      : { top: rect.bottom + GAP }),
  }
}
