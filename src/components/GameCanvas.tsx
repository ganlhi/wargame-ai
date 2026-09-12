import { useRef, useEffect, useCallback, useState } from 'react'
import { Application, Graphics, Container } from 'pixi.js'
import { useGameStore } from '../stores/gameStore'
import { Select } from './Select'
import { TERRAIN_COLORS, TERRAIN_TYPE_OPTIONS } from '../utils/terrainStyles'
import type { GameState, TerrainType, UnitStatus } from '../types'
import { arcMaxRange, arcSideToAngles } from '../types'
import { computeAttitude, ATTITUDE_LABELS, COMPASS_LABELS, windTowardPoint } from '../utils/attitude'
import { applyMovementPlan, turnOrderFor, unitsAtChunk } from '../game/movement'
import type { Point } from '../utils/geometry'
import { terrainPolygon } from '../utils/geometry'
import { dashSegments } from '../utils/dashedPath'
import {
  formatOffset, originPoint, terrainReferencePoint, toOffset, unitReferencePoint,
} from '../utils/coordinates'
import type { Viewport } from '../utils/viewport'
import { PADDING, computeViewport, panViewport, toScreen, toWorld, zoomViewport } from '../utils/viewport'

const GRID_COLOR = 0xffffff
const GRID_ALPHA = 0.06
const ORIGIN_COLOR = 0x38bdf8

const TERRAIN_FILL_ALPHA = 0.35
const TERRAIN_BORDER_WIDTH = 2

/**
 * Every point the view needs to show is derived in `src/utils/viewport.ts`; the
 * grid spacing here just follows whatever scale that lands on.
 */

/** Grid spacings tried in order; the first that isn't visually dense wins. */
const GRID_STEPS = [50, 100, 250, 500, 1000, 2500, 5000]
const MAX_GRID_LINES = 40

/** How far a pointer must travel before a tap becomes a pan, in pixels. */
const PAN_THRESHOLD = 4

/** Dash pattern for a drift track, in screen pixels. */
const DRIFT_DASH = 6
const DRIFT_DASH_GAP = 5

function getStatusColor(status: UnitStatus): number | null {
  switch (status) {
    case 'grappled': return 0xf59e0b
    case 'immobilised': return 0xeab308
    case 'destroyed': return 0x6b7280
    case 'surrendered': return 0xffffff
    default: return null
  }
}

interface GameCanvasProps {
  onEditUnit?: (unitId: string) => void
  onEditTerrain?: (terrainId: string) => void
  placementMode?: boolean
  onTableClick?: (worldX: number, worldY: number) => void
  showBases?: boolean
  /**
   * During the reveal, which step of the turn the ships are drawn at: 0 = as
   * the turn opens, 1–5 = the end of that chunk. Ignored in every other phase.
   */
  previewChunk?: number
}

export function GameCanvas({
  onEditUnit,
  onEditTerrain,
  placementMode = false,
  onTableClick,
  showBases = false,
  previewChunk = 5,
}: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const initialized = useRef(false)
  const gridContainerRef = useRef<Container | null>(null)
  const terrainContainerRef = useRef<Container | null>(null)
  const unitsContainerRef = useRef<Container | null>(null)
  const overlayContainerRef = useRef<Container | null>(null)
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [movingTerrainId, setMovingTerrainId] = useState<string | null>(null)
  // null = follow the content automatically; set = the player has taken manual
  // control of the view by panning or zooming, until they hit Fit.
  const [view, setView] = useState<Viewport | null>(null)
  const [placementCursorPos, setPlacementCursorPos] = useState<{
    screenX: number
    screenY: number
    label: string
  } | null>(null)

  const currentGame = useGameStore((s) => s.currentGame)
  const updateTerrain = useGameStore((s) => s.updateTerrain)
  const removeTerrain = useGameStore((s) => s.removeTerrain)
  const removeUnit = useGameStore((s) => s.removeUnit)
  const setGrapple = useGameStore((s) => s.setGrapple)
  const setOrigin = useGameStore((s) => s.setOrigin)

  const placementModeRef = useRef(placementMode)
  const sizeRef = useRef({ w: 0, h: 0 })
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const moveDragStart = useRef<{ world: Point; center: Point } | null>(null)
  // A drag only pans when it began on empty water — starting on a ship or a
  // terrain piece is a selection (or a terrain move), not a pan.
  const panAllowedRef = useRef(false)
  const didPanRef = useRef(false)
  const viewportForRef = useRef<(w: number, h: number) => Viewport>(() => ({ scale: 1, offsetX: 0, offsetY: 0 }))
  const handleMoveDragRef = useRef<(sx: number, sy: number) => void>(() => {})
  const renderGridRef = useRef<() => void>(() => {})
  const renderTerrainRef = useRef<() => void>(() => {})
  const renderUnitsRef = useRef<() => void>(() => {})
  const renderOverlayRef = useRef<() => void>(() => {})

  useEffect(() => { placementModeRef.current = placementMode }, [placementMode])
  const onTableClickRef = useRef(onTableClick)
  useEffect(() => { onTableClickRef.current = onTableClick }, [onTableClick])

  const getSize = useCallback(() => {
    const el = containerRef.current
    if (!el) return { w: 0, h: 0 }
    return { w: el.clientWidth, h: el.clientHeight }
  }, [])

  // The auto-fit viewport is derived from every point on the table, and
  // worldToScreen asks for it once per point drawn, so memoise it per render
  // pass rather than recomputing the content bounds thousands of times.
  const autoViewportCache = useRef<{ game: GameState | null; w: number; h: number; vp: Viewport } | null>(null)

  const viewportFor = useCallback(
    (w: number, h: number): Viewport => {
      if (view) return view
      const cached = autoViewportCache.current
      if (cached && cached.game === currentGame && cached.w === w && cached.h === h) return cached.vp
      const vp = computeViewport(currentGame, w, h)
      autoViewportCache.current = { game: currentGame, w, h, vp }
      return vp
    },
    [view, currentGame],
  )

  const worldToScreen = useCallback(
    (wx: number, wy: number, w: number, h: number) => toScreen(viewportFor(w, h), wx, wy),
    [viewportFor],
  )

  const screenToWorld = useCallback(
    (sx: number, sy: number, w: number, h: number) => toWorld(viewportFor(w, h), sx, sy),
    [viewportFor],
  )

  const screenToWorldRef = useRef(screenToWorld)
  useEffect(() => { screenToWorldRef.current = screenToWorld }, [screenToWorld])
  useEffect(() => { viewportForRef.current = viewportFor }, [viewportFor])

  const origin = currentGame ? originPoint(currentGame) : { x: 0, y: 0 }
  const originRef = useRef(origin)
  useEffect(() => { originRef.current = origin })

  useEffect(() => {
    if (!placementMode) return
    const el = containerRef.current
    if (!el) return
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      const { w, h } = sizeRef.current
      if (!w || !h) return
      const pos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, w, h)
      setPlacementCursorPos({
        screenX: e.clientX,
        screenY: e.clientY,
        label: formatOffset(toOffset(pos, originRef.current)),
      })
    }
    el.addEventListener('pointermove', onMove)
    return () => el.removeEventListener('pointermove', onMove)
  }, [placementMode, screenToWorld])

  /**
   * Pan and zoom. Both work by snapshotting the viewport when the gesture
   * starts and deriving the new one from the total pointer delta, so a long
   * drag can't accumulate rounding drift. Zooming keeps the world point under
   * the cursor (or under the pinch midpoint) pinned where it is.
   */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const pointers = new Map<number, { x: number; y: number }>()
    let gesture:
      | { kind: 'pan'; startView: Viewport; startX: number; startY: number }
      | { kind: 'pinch'; startView: Viewport; startDist: number; startMidX: number; startMidY: number }
      | null = null

    const localPoint = (e: { clientX: number; clientY: number }) => {
      const rect = el.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const currentViewport = () => {
      const { w, h } = sizeRef.current
      return viewportForRef.current(w, h)
    }

    const onPointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, localPoint(e))
      didPanRef.current = false

      if (pointers.size === 2) {
        // Pinch beats everything, wherever it starts.
        const [a, b] = [...pointers.values()]
        gesture = {
          kind: 'pinch',
          startView: currentViewport(),
          startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          startMidX: (a.x + b.x) / 2,
          startMidY: (a.y + b.y) / 2,
        }
      } else if (pointers.size === 1 && panAllowedRef.current && !moveDragStart.current) {
        const p = localPoint(e)
        gesture = { kind: 'pan', startView: currentViewport(), startX: p.x, startY: p.y }
      } else {
        gesture = null
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, localPoint(e))
      if (!gesture) return

      if (gesture.kind === 'pan') {
        const p = localPoint(e)
        const dx = p.x - gesture.startX
        const dy = p.y - gesture.startY
        if (!didPanRef.current && Math.hypot(dx, dy) < PAN_THRESHOLD) return
        didPanRef.current = true
        setView(panViewport(gesture.startView, dx, dy))
        return
      }

      if (pointers.size < 2) return
      const [a, b] = [...pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      didPanRef.current = true
      // Track the midpoint too, so a two-finger drag pans while it zooms.
      const zoomed = zoomViewport(
        gesture.startView, dist / gesture.startDist, gesture.startMidX, gesture.startMidY,
      )
      // Then carry the whole thing along with the midpoint, so two fingers pan
      // as well as pinch.
      setView(panViewport(zoomed, (a.x + b.x) / 2 - gesture.startMidX, (a.y + b.y) / 2 - gesture.startMidY))
    }

    const endPointer = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) gesture = null
      if (pointers.size === 0) {
        panAllowedRef.current = false
        // Let the Pixi pointerup handler see that this was a drag, then clear.
        requestAnimationFrame(() => { didPanRef.current = false })
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = localPoint(e)
      // Ctrl+wheel is the trackpad pinch gesture; both zoom here.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
      setView(zoomViewport(currentViewport(), factor, p.x, p.y))
    }

    // Down on the canvas, but move/up on the window: a drag that runs off the
    // edge must keep panning and must still end cleanly. Pointer capture would
    // do the same but would retarget the events away from Pixi's own canvas
    // listeners, breaking selection.
    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endPointer)
    window.addEventListener('pointercancel', endPointer)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endPointer)
      window.removeEventListener('pointercancel', endPointer)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  /** Zoom by a fixed step about the middle of the canvas (the on-screen buttons). */
  const zoomByStep = useCallback(
    (factor: number) => {
      const { w, h } = sizeRef.current
      setView(zoomViewport(viewportFor(w, h), factor, w / 2, h / 2))
    },
    [viewportFor],
  )

  const renderGrid = useCallback(() => {
    const gc = gridContainerRef.current
    if (!gc || !currentGame) return
    gc.removeChildren()
    const { w, h } = sizeRef.current
    if (!w || !h) return

    const v = viewportFor(w, h)
    const anchor = originPoint(currentGame)

    // Grid lines run through the origin so the coordinate frame is legible, and
    // the spacing coarsens as the view zooms out to keep the count sane.
    const step =
      GRID_STEPS.find((s) => (w / v.scale) / s <= MAX_GRID_LINES && (h / v.scale) / s <= MAX_GRID_LINES) ??
      GRID_STEPS[GRID_STEPS.length - 1]

    const worldLeft = (0 - v.offsetX) / v.scale
    const worldRight = (w - v.offsetX) / v.scale
    const worldTop = (0 - v.offsetY) / v.scale
    const worldBottom = (h - v.offsetY) / v.scale

    const grid = new Graphics()
    const firstX = Math.ceil((worldLeft - anchor.x) / step) * step + anchor.x
    for (let x = firstX; x <= worldRight; x += step) {
      const px = x * v.scale + v.offsetX
      grid.moveTo(px, 0)
      grid.lineTo(px, h)
    }
    const firstY = Math.ceil((worldTop - anchor.y) / step) * step + anchor.y
    for (let y = firstY; y <= worldBottom; y += step) {
      const py = y * v.scale + v.offsetY
      grid.moveTo(0, py)
      grid.lineTo(w, py)
    }
    grid.stroke({ color: GRID_COLOR, width: 1, alpha: GRID_ALPHA })
    gc.addChild(grid)

    // The origin itself, marked with a crosshair through (0, 0).
    const o = worldToScreen(anchor.x, anchor.y, w, h)
    const cross = new Graphics()
    cross.moveTo(o.x - 10, o.y)
    cross.lineTo(o.x + 10, o.y)
    cross.moveTo(o.x, o.y - 10)
    cross.lineTo(o.x, o.y + 10)
    cross.stroke({ color: ORIGIN_COLOR, width: 1.5, alpha: 0.7 })
    cross.circle(o.x, o.y, 4)
    cross.stroke({ color: ORIGIN_COLOR, width: 1, alpha: 0.5 })
    gc.addChild(cross)
  }, [currentGame, viewportFor, worldToScreen])

  const renderTerrain = useCallback(() => {
    const tc = terrainContainerRef.current
    if (!tc || !currentGame) return
    tc.removeChildren()
    const { w, h } = sizeRef.current
    if (!w || !h) return

    for (const t of currentGame.terrain) {
      const sv = terrainPolygon(t).map((v) => worldToScreen(v.x, v.y, w, h))
      const c = TERRAIN_COLORS[t.type]
      const isSelected = t.id === selectedTerrainId
      const isMoving = t.id === movingTerrainId

      const g = new Graphics()
      g.poly(sv.flatMap((v) => [v.x, v.y]))
      g.fill({ color: parseInt(c.fill.slice(1), 16), alpha: TERRAIN_FILL_ALPHA })
      g.stroke({
        color: isSelected || isMoving ? 0xffffff : parseInt(c.border.slice(1), 16),
        width: isSelected || isMoving ? 3 : TERRAIN_BORDER_WIDTH,
        alpha: 0.9,
      })
      g.eventMode = 'static'
      g.cursor = isMoving ? 'grab' : 'pointer'
      g.on('pointerdown', (e) => {
        if (placementModeRef.current) return
        e.stopPropagation()
        panAllowedRef.current = false

        if (t.id === movingTerrainId) {
          const world = screenToWorldRef.current(e.global.x, e.global.y, w, h)
          moveDragStart.current = { world, center: { ...t.center } }
          const onMove = (ev: PointerEvent) => handleMoveDragRef.current(ev.clientX, ev.clientY)
          const onUp = () => {
            moveDragStart.current = null
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          return
        }

        setSelectedTerrainId(t.id)
        setMenuPos({ x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
        setSelectedUnitId(null)
      })
      tc.addChild(g)
    }
  }, [currentGame, worldToScreen, selectedTerrainId, movingTerrainId])

  const renderUnits = useCallback(() => {
    const uc = unitsContainerRef.current
    if (!uc || !currentGame) return
    uc.removeChildren()
    const { w, h } = sizeRef.current
    if (!w || !h) return

    const { scale } = viewportFor(w, h)

    // Once the orders are on the table the ships are drawn where they will
    // stand at the previewed step of the turn, so the player can walk the
    // models along chunk by chunk. Everywhere else they sit where they are.
    const units =
      currentGame.currentPhase === 'reveal'
        ? unitsAtChunk(currentGame.units, currentGame.windDirection, previewChunk)
        : currentGame.units

    // Grapple link lines, drawn first so the ship icons sit on top. One line per
    // pair (dedup via sorted id key) connecting the two grappled units.
    const drawnLinks = new Set<string>()
    for (const u of units) {
      if (!u.grappledWith) continue
      const partner = units.find((p) => p.id === u.grappledWith)
      if (!partner) continue
      const key = [u.id, partner.id].sort().join('|')
      if (drawnLinks.has(key)) continue
      drawnLinks.add(key)
      const a = worldToScreen(u.position.x, u.position.y, w, h)
      const b = worldToScreen(partner.position.x, partner.position.y, w, h)
      const link = new Graphics()
      link.moveTo(a.x, a.y)
      link.lineTo(b.x, b.y)
      link.stroke({ color: 0xf59e0b, width: 2, alpha: 0.75 })
      uc.addChild(link)
    }

    for (const u of units) {
      const pos = worldToScreen(u.position.x, u.position.y, w, h)
      const container = new Container()
      container.x = pos.x
      container.y = pos.y
      container.rotation = (u.orientation * Math.PI / 16) - Math.PI / 2

      const isPlayer = u.side === 'player'
      const isDisabled = u.status === 'destroyed' || u.status === 'surrendered'
      const hullColor = isPlayer ? 0x3b82f6 : 0xef4444
      const isSelected = u.id === selectedUnitId

      // Base footprint (drawn first, so the ship icon sits on top). The
      // container is already rotated to the heading, with local +x = bow, so the
      // base length runs along x and the width along y.
      if (showBases && u.baseWidth > 0 && u.baseLength > 0) {
        const halfL = (u.baseLength / 2) * scale
        const halfW = (u.baseWidth / 2) * scale
        const base = new Graphics()
        base.rect(-halfL, -halfW, halfL * 2, halfW * 2)
        base.fill({ color: hullColor, alpha: 0.1 })
        base.stroke({ color: hullColor, width: 1, alpha: isDisabled ? 0.3 : 0.55 })
        container.addChild(base)
      }

      const g = new Graphics()
      g.moveTo(12, 0)
      g.lineTo(8, -4)
      g.lineTo(-2, -5)
      g.lineTo(-8, -3)
      g.lineTo(-10, 0)
      g.lineTo(-8, 3)
      g.lineTo(-2, 5)
      g.lineTo(8, 4)
      g.closePath()
      g.fill({ color: isDisabled ? 0x6b7280 : hullColor, alpha: isDisabled ? 0.4 : 0.9 })
      g.stroke({ color: isSelected ? 0xffffff : 0x94a3b8, width: isSelected ? 2 : 1, alpha: 0.8 })

      const statusColor = getStatusColor(u.status)
      if (statusColor !== null) {
        const dot = new Graphics()
        dot.circle(0, 7, 3)
        dot.fill({ color: statusColor })
        dot.stroke({ color: 0xffffff, width: 1, alpha: 0.6 })
        container.addChild(dot)
      }

      g.eventMode = 'static'
      g.cursor = 'pointer'
      const unitId = u.id
      g.on('pointerdown', (e) => {
        if (placementModeRef.current) return
        e.stopPropagation()
        panAllowedRef.current = false
        setSelectedUnitId(unitId)
        setSelectedTerrainId(null)
        setMenuPos(null)
      })

      container.addChild(g)
      uc.addChild(container)
    }
  }, [currentGame, worldToScreen, viewportFor, selectedUnitId, showBases, previewChunk])

  const renderOverlay = useCallback(() => {
    const oc = overlayContainerRef.current
    if (!oc || !currentGame) return
    oc.removeChildren()
    const { w, h } = sizeRef.current
    if (!w || !h) return

    const { scale } = viewportFor(w, h)

    // Compass rose, anchored to the canvas rather than to a table rectangle.
    const compassR = 16
    const cx = PADDING + compassR
    const cy = h - PADDING - compassR

    const g = new Graphics()
    g.circle(cx, cy, compassR)
    g.stroke({ color: 0xffffff, width: 1, alpha: 0.25 })

    const N = -Math.PI / 2
    const S = Math.PI / 2
    const E = 0
    const W = Math.PI

    g.moveTo(cx, cy)
    g.lineTo(cx + compassR * Math.cos(N), cy + compassR * Math.sin(N))
    g.stroke({ color: 0xef4444, width: 2, alpha: 0.9 })

    for (const dir of [S, E, W]) {
      g.moveTo(cx, cy)
      g.lineTo(cx + compassR * Math.cos(dir), cy + compassR * Math.sin(dir))
      g.stroke({ color: 0xffffff, width: 1, alpha: 0.25 })
    }

    // Screen angle of the point the wind blows toward. Written via
    // windTowardPoint so it can't be confused with the "+8" (90° off) form.
    const windAngle = (windTowardPoint(currentGame.windDirection) * Math.PI) / 16 - Math.PI / 2
    const arrowLen = 20
    const arrowOffset = compassR + 4
    const ax = cx + Math.cos(windAngle) * arrowOffset
    const ay = cy + Math.sin(windAngle) * arrowOffset
    const tipX = ax + Math.cos(windAngle) * arrowLen
    const tipY = ay + Math.sin(windAngle) * arrowLen

    g.moveTo(ax, ay)
    g.lineTo(tipX, tipY)
    g.stroke({ color: 0x60a5fa, width: 2.5, alpha: 0.85 })

    const headLen = 7
    const headSpread = Math.PI / 6
    g.moveTo(tipX, tipY)
    g.lineTo(tipX - Math.cos(windAngle - headSpread) * headLen, tipY - Math.sin(windAngle - headSpread) * headLen)
    g.moveTo(tipX, tipY)
    g.lineTo(tipX - Math.cos(windAngle + headSpread) * headLen, tipY - Math.sin(windAngle + headSpread) * headLen)
    g.stroke({ color: 0x60a5fa, width: 2, alpha: 0.85 })

    oc.addChild(g)

    const drawPlanPath = (u: typeof currentGame.units[number], plan: typeof u.hiddenAIOrder, color: number) => {
      if (!plan) return
      // The very walk that will resolve the move draws it, so the track shows
      // the sideways jog of every corner pivot exactly where it will happen.
      // The track follows the ship's reference point — the middle of her stern
      // edge, the point a player measures her by — not the base centre.
      const { path } = applyMovementPlan(u, plan, currentGame.windDirection)
      const track: Point[] = path.map((p) => worldToScreen(p.x, p.y, w, h))

      // A declared tack drifts from its first chunk, even though the ship is
      // still beating as the turn opens.
      const drifting = u.isInIrons || !!plan.isTack

      // A ship under way is drawn with a solid track; one making no way of its
      // own and going where the wind takes it is dashed, so the two read apart
      // at a glance.
      const pathG = new Graphics()
      if (drifting) {
        for (const [from, to] of dashSegments(track, DRIFT_DASH, DRIFT_DASH_GAP)) {
          pathG.moveTo(from.x, from.y)
          pathG.lineTo(to.x, to.y)
        }
      } else {
        pathG.moveTo(track[0].x, track[0].y)
        for (const point of track.slice(1)) pathG.lineTo(point.x, point.y)
      }
      pathG.stroke({ color, width: 2, alpha: 0.6 })
      oc.addChild(pathG)

      // The end marker sits on the same reference point the track was drawn
      // through, so it lands where the stern will be measured to.
      const endPos = track[track.length - 1]
      const dot = new Graphics()
      dot.circle(endPos.x, endPos.y, 4)
      dot.fill({ color, alpha: 0.8 })
      oc.addChild(dot)
    }

    for (const u of currentGame.units) {
      if (u.side === 'ai' && u.hiddenAIOrder && currentGame.currentPhase === 'reveal' && (u.status === 'active' || u.status === 'immobilised')) {
        drawPlanPath(u, u.hiddenAIOrder, 0xfbbf24)
      }
      if (u.side === 'player' && u.playerOrder && u.status === 'active' && (currentGame.currentPhase === 'orders' || currentGame.currentPhase === 'reveal')) {
        drawPlanPath(u, u.playerOrder, 0x3b82f6)
      }
    }

    const selectedUnit = currentGame.units.find((u) => u.id === selectedUnitId)
    if (selectedUnit && selectedUnit.firingArcs.length > 0 && selectedUnit.hiddenAIFirePlan) {
      const plan = turnOrderFor(selectedUnit, currentGame.windDirection)
      const firePlan = selectedUnit.hiddenAIFirePlan

      if (plan && firePlan) {
        // The shot is taken from the pose at the end of the firing chunk —
        // the same pose the fire plan was computed against.
        const { poses } = applyMovementPlan(selectedUnit, plan, currentGame.windDirection)
        const firing = poses[Math.min(firePlan.chunkIndex + 1, poses.length - 1)]

        const firingPos = worldToScreen(firing.x, firing.y, w, h)
        const firingOrientDeg = firing.orientation * 360 / 32
        const arc = selectedUnit.firingArcs.find((a) => a.side === firePlan.arcSide)
        if (arc) {
          const a = arcSideToAngles(arc.side)
          const worldMin = ((firingOrientDeg + a.minAngle) % 360 + 360) % 360
          const worldMax = ((firingOrientDeg + a.maxAngle) % 360 + 360) % 360
          const radius = arcMaxRange(arc) * scale
          const toScreenAngle = (deg: number) => (deg - 90) * Math.PI / 180
          const steps = 16
          const color = 0x22c55e

          const wedge = new Graphics()
          wedge.moveTo(firingPos.x, firingPos.y)
          wedge.lineTo(firingPos.x + Math.cos(toScreenAngle(worldMin)) * radius, firingPos.y + Math.sin(toScreenAngle(worldMin)) * radius)
          const sweepDeg = worldMin <= worldMax ? worldMax - worldMin : 360 + worldMax - worldMin
          for (let i = 1; i <= steps; i++) {
            const angle = (worldMin + sweepDeg * (i / steps)) % 360
            wedge.lineTo(firingPos.x + Math.cos(toScreenAngle(angle)) * radius, firingPos.y + Math.sin(toScreenAngle(angle)) * radius)
          }
          wedge.closePath()
          wedge.fill({ color, alpha: 0.15 })
          wedge.stroke({ color, width: 1.5, alpha: 0.4 })
          oc.addChild(wedge)

          const border = new Graphics()
          for (const deg of [worldMin, worldMax]) {
            const t = toScreenAngle(deg)
            border.moveTo(firingPos.x, firingPos.y)
            border.lineTo(firingPos.x + Math.cos(t) * radius, firingPos.y + Math.sin(t) * radius)
          }
          border.stroke({ color, width: 1, alpha: 0.5 })
          oc.addChild(border)

          const arcG = new Graphics()
          const aStart = toScreenAngle(worldMin)
          arcG.arc(firingPos.x, firingPos.y, radius, aStart, aStart + (sweepDeg * Math.PI) / 180)
          arcG.stroke({ color, width: 1.5, alpha: 0.3 })
          oc.addChild(arcG)
        }
      }
    }
  }, [currentGame, worldToScreen, viewportFor, selectedUnitId])

  const handleMoveDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (!moveDragStart.current || !movingTerrainId) return
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const { w, h } = sizeRef.current
      if (!w || !h) return
      const pos = screenToWorldRef.current(clientX - rect.left, clientY - rect.top, w, h)
      const { world, center } = moveDragStart.current
      updateTerrain(movingTerrainId, {
        center: {
          x: Math.round(center.x + (pos.x - world.x)),
          y: Math.round(center.y + (pos.y - world.y)),
        },
      })
    },
    [movingTerrainId, updateTerrain],
  )

  useEffect(() => { handleMoveDragRef.current = handleMoveDrag }, [handleMoveDrag])
  useEffect(() => { renderGridRef.current = renderGrid }, [renderGrid])
  useEffect(() => { renderTerrainRef.current = renderTerrain }, [renderTerrain])
  useEffect(() => { renderUnitsRef.current = renderUnits }, [renderUnits])
  useEffect(() => { renderOverlayRef.current = renderOverlay }, [renderOverlay])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    if (initialized.current) {
      renderGrid()
      renderTerrain()
      renderUnits()
      renderOverlay()
      return
    }

    const app = new Application()
    appRef.current = app
    let destroyed = false

    app.init({ backgroundAlpha: 0, antialias: true }).then(() => {
      if (destroyed) {
        try { app.destroy(true) } catch { /* PixiJS v8 cleanup quirk */ }
        return
      }
      const { w, h } = getSize()
      app.renderer.resize(w, h)
      el.appendChild(app.canvas)
      sizeRef.current = { w, h }
      initialized.current = true

      const grid = new Container()
      const terrain = new Container()
      const units = new Container()
      const overlay = new Container()
      app.stage.addChild(grid, terrain, units, overlay)
      gridContainerRef.current = grid
      terrainContainerRef.current = terrain
      unitsContainerRef.current = units
      overlayContainerRef.current = overlay

      const hit = new Graphics()
      const drawHit = () => {
        hit.clear()
        hit.rect(0, 0, sizeRef.current.w, sizeRef.current.h)
        hit.fill({ color: 0x000000, alpha: 0.001 })
      }
      drawHit()
      hit.eventMode = 'static'
      // Pressing empty water arms a pan; the selection/placement decision waits
      // for the release, so a drag pans the map instead of clearing the
      // selection out from under it.
      hit.on('pointerdown', () => {
        panAllowedRef.current = true
      })
      hit.on('pointerup', (e) => {
        if (didPanRef.current) return
        if (placementModeRef.current && onTableClickRef.current) {
          const { w: cw, h: ch } = sizeRef.current
          if (cw && ch) {
            // The table is infinite: any point the player can click is valid.
            const pos = screenToWorldRef.current(e.global.x, e.global.y, cw, ch)
            onTableClickRef.current(Math.round(pos.x), Math.round(pos.y))
          }
          return
        }
        if (!moveDragStart.current) {
          setSelectedTerrainId(null)
          setMenuPos(null)
          setSelectedUnitId(null)
          setMovingTerrainId(null)
        }
      })
      app.stage.addChildAt(hit, 0)

      const ro = new ResizeObserver(() => {
        const { w: newW, h: newH } = getSize()
        if (newW && newH) {
          app.renderer.resize(newW, newH)
          sizeRef.current = { w: newW, h: newH }
          drawHit()
          renderGridRef.current()
          renderTerrainRef.current()
          renderUnitsRef.current()
          renderOverlayRef.current()
        }
      })
      ro.observe(el)
      resizeObserverRef.current = ro

      renderGridRef.current()
      renderTerrainRef.current()
      renderUnitsRef.current()
      renderOverlayRef.current()
    })

    return () => {
      resizeObserverRef.current?.disconnect()
      destroyed = true
      if (initialized.current) {
        try { app.destroy(true) } catch { /* PixiJS v8 cleanup quirk */ }
      }
      initialized.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { renderGrid() }, [renderGrid])
  useEffect(() => { renderTerrain() }, [renderTerrain])
  useEffect(() => { renderUnits() }, [renderUnits])
  useEffect(() => { renderOverlay() }, [renderOverlay])

  useEffect(() => {
    const app = appRef.current
    if (!app || !initialized.current || app.stage.children.length === 0) return
    const hit = app.stage.getChildAt(0) as Graphics
    hit.cursor = placementMode ? 'crosshair' : 'grab'
  }, [placementMode])

  const selectedTerrain = selectedTerrainId
    ? currentGame?.terrain.find((t) => t.id === selectedTerrainId)
    : undefined
  const selectedUnit = selectedUnitId
    ? currentGame?.units.find((u) => u.id === selectedUnitId)
    : undefined

  return (
    <div className="flex flex-col flex-1 relative">
      <div ref={containerRef} className="flex-1" style={{ touchAction: 'none' }} />

      <div className="absolute right-2 bottom-2 flex flex-col gap-1">
        <button
          onClick={() => zoomByStep(1.3)}
          className="w-8 h-8 bg-gray-900/85 border border-gray-700 rounded text-gray-300 hover:text-white text-lg leading-none backdrop-blur-sm transition-colors cursor-pointer"
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => zoomByStep(1 / 1.3)}
          className="w-8 h-8 bg-gray-900/85 border border-gray-700 rounded text-gray-300 hover:text-white text-lg leading-none backdrop-blur-sm transition-colors cursor-pointer"
          title="Zoom out"
          aria-label="Zoom out"
        >
          &minus;
        </button>
        <button
          onClick={() => setView(null)}
          disabled={view === null}
          className="w-8 h-8 bg-gray-900/85 border border-gray-700 rounded text-[10px] font-medium text-gray-300 hover:text-white disabled:opacity-35 disabled:cursor-default backdrop-blur-sm transition-colors cursor-pointer"
          title={view === null ? 'Already following the action' : 'Fit everything back on screen'}
          aria-label="Fit view"
        >
          Fit
        </button>
      </div>

      {movingTerrainId && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900/90 border border-gray-700 rounded-lg px-4 py-2.5 backdrop-blur-sm flex gap-2 items-center">
          <span className="text-xs text-gray-400">Drag the terrain to reposition it</span>
          <button
            onClick={() => {
              setMovingTerrainId(null)
              setSelectedTerrainId(null)
              setMenuPos(null)
            }}
            className="text-xs text-green-400 hover:text-green-300 border border-green-800 rounded px-2 py-1 transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      )}

      {selectedTerrain && menuPos && (
        <div
          className="fixed z-50 bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-xl w-48"
          style={{ left: menuPos.x, top: menuPos.y, transform: 'translate(-50%, -100%) translateY(-8px)' }}
        >
          <div className="text-xs text-gray-400 mb-1 uppercase tracking-wider font-semibold">
            {TERRAIN_COLORS[selectedTerrain.type].label}
          </div>
          <div className="text-xs text-gray-500 mb-2 capitalize">
            {selectedTerrain.shape.kind}
            {selectedTerrain.shape.kind === 'circle'
              ? ` ⌀${selectedTerrain.shape.width}mm`
              : ` ${selectedTerrain.shape.width}×${selectedTerrain.shape.height}mm`}
            <br />
            {currentGame?.originId === selectedTerrain.id
              ? 'Origin'
              : formatOffset(toOffset(terrainReferencePoint(selectedTerrain), origin))}
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs text-gray-300">Type</label>
            <Select<TerrainType>
              value={selectedTerrain.type}
              onChange={(type) => updateTerrain(selectedTerrain.id, { type })}
              size="sm"
              className="w-full"
              ariaLabel="Terrain type"
              options={TERRAIN_TYPE_OPTIONS}
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => {
                setMovingTerrainId(selectedTerrain.id)
                setMenuPos(null)
              }}
              className="flex-1 text-xs text-blue-400 hover:text-blue-300 border border-blue-800 rounded px-2 py-1.5 transition-colors cursor-pointer"
            >
              Move
            </button>
            <button
              onClick={() => {
                const id = selectedTerrain.id
                setSelectedTerrainId(null)
                setMenuPos(null)
                onEditTerrain?.(id)
              }}
              className="flex-1 text-xs text-green-400 hover:text-green-300 border border-green-800 rounded px-2 py-1.5 transition-colors cursor-pointer"
            >
              Edit
            </button>
          </div>
          {currentGame?.originId !== selectedTerrain.id && (
            <button
              onClick={() => setOrigin(selectedTerrain.id)}
              className="mt-2 w-full text-xs text-sky-400 hover:text-sky-300 border border-sky-800 rounded px-2 py-1.5 transition-colors cursor-pointer"
            >
              Set as origin
            </button>
          )}
          <button
            onClick={() => {
              removeTerrain(selectedTerrain.id)
              setSelectedTerrainId(null)
              setMenuPos(null)
            }}
            className="mt-2 w-full text-xs text-red-400 hover:text-red-300 border border-red-800 rounded px-2 py-1.5 transition-colors cursor-pointer"
          >
            Delete
          </button>
        </div>
      )}

      {selectedUnit && (
        <div className="absolute z-50 bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-xl w-52 left-2 top-2">
          <div className="text-xs text-gray-400 mb-1 uppercase tracking-wider font-semibold">{selectedUnit.name}</div>
          <div className="flex gap-1.5 mb-2">
            <span className={`text-xs px-1.5 py-0.5 rounded ${selectedUnit.side === 'player' ? 'bg-blue-600/30 text-blue-300' : 'bg-red-600/30 text-red-300'}`}>
              {selectedUnit.side === 'player' ? 'Player' : 'AI'}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 capitalize">{selectedUnit.status}</span>
            {currentGame?.originId === selectedUnit.id && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-sky-600/30 text-sky-300">Origin</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mb-1">
            {currentGame?.originId === selectedUnit.id
              ? 'Stern at the origin (0, 0)'
              : `Stern: ${formatOffset(toOffset(unitReferencePoint(selectedUnit), origin))}`}
          </div>
          <div className="text-xs text-gray-500 mb-3">
            Orientation: {COMPASS_LABELS[selectedUnit.orientation]} &middot; Attitude: {currentGame ? ATTITUDE_LABELS[computeAttitude(currentGame.windDirection, selectedUnit.orientation, selectedUnit.foreAndAftRigged)] : ''}
          </div>

          {(() => {
            const partner = selectedUnit.grappledWith
              ? currentGame?.units.find((u) => u.id === selectedUnit.grappledWith)
              : null
            const candidates = (currentGame?.units ?? []).filter(
              (u) => u.id !== selectedUnit.id && u.status !== 'destroyed' && u.status !== 'surrendered',
            )
            return (
              <div className="mb-3 border-t border-gray-800 pt-2">
                {partner ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-amber-400">
                      ⚓ Grappled with <span className="font-medium">{partner.name}</span>
                    </span>
                    <button
                      onClick={() => setGrapple(selectedUnit.id, null)}
                      className="text-xs text-amber-400 hover:text-amber-300 border border-amber-800 rounded px-2 py-1 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Release
                    </button>
                  </div>
                ) : candidates.length > 0 ? (
                  <label className="block">
                    <span className="text-xs text-gray-400">Grapple with</span>
                    <Select
                      value=""
                      onChange={(id) => id && setGrapple(selectedUnit.id, id)}
                      placeholder="Select a ship…"
                      size="sm"
                      className="mt-1 w-full"
                      ariaLabel="Grapple with"
                      options={candidates.map((u) => ({ value: u.id, label: u.name }))}
                    />
                  </label>
                ) : (
                  <span className="text-xs text-gray-600">No other ships to grapple</span>
                )}
              </div>
            )
          })()}

          {currentGame?.originId !== selectedUnit.id && (
            <button
              onClick={() => setOrigin(selectedUnit.id)}
              className="mb-2 w-full text-xs text-sky-400 hover:text-sky-300 border border-sky-800 rounded px-2 py-1.5 transition-colors cursor-pointer"
            >
              Set as origin
            </button>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => {
                setSelectedUnitId(null)
                onEditUnit?.(selectedUnit.id)
              }}
              className="flex-1 text-xs text-blue-400 hover:text-blue-300 border border-blue-800 rounded px-2 py-1.5 transition-colors cursor-pointer"
            >
              Edit
            </button>
            <button
              onClick={() => {
                removeUnit(selectedUnit.id)
                setSelectedUnitId(null)
              }}
              className="flex-1 text-xs text-red-400 hover:text-red-300 border border-red-800 rounded px-2 py-1.5 transition-colors cursor-pointer"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {placementMode && placementCursorPos && (
        <div
          className="fixed z-40 pointer-events-none bg-gray-900/80 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-200"
          style={{ left: placementCursorPos.screenX + 14, top: placementCursorPos.screenY - 10 }}
        >
          {placementCursorPos.label}
        </div>
      )}
    </div>
  )
}
