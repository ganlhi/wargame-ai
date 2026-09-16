import { useRef, useEffect, useCallback, useState } from 'react'
import { Application, Graphics, Container } from 'pixi.js'
import { useGameStore } from '../stores/gameStore'
import { Select } from './Select'
import { TERRAIN_COLORS, TERRAIN_TYPE_OPTIONS } from '../utils/terrainStyles'
import type { AIStyle, GameState, TerrainType, UnitStatus } from '../types'
import { ATTITUDE_LABELS, COMPASS_LABELS, windTowardPoint } from '../utils/attitude'
import { applyMovementPlan, turnOrderFor } from '../game/movement'
import type { Point } from '../utils/geometry'
import { terrainPolygon } from '../utils/geometry'
import { dashSegments } from '../utils/dashedPath'
import {
  formatBearing, fromBearing, originPoint, terrainReferencePoint, toBearing, unitReferencePoint,
} from '../utils/coordinates'
import type { Viewport } from '../utils/viewport'
import { PADDING, computeViewport, panViewport, toScreen, toWorld, zoomViewport } from '../utils/viewport'

const GRID_COLOR = 0xffffff
const GRID_ALPHA = 0.06
const ORIGIN_COLOR = 0x38bdf8

const AI_STYLE_OPTIONS: { value: AIStyle; label: string }[] = [
  { value: 'aggressive', label: 'Aggressive' },
  { value: 'cautious', label: 'Cautious' },
  { value: 'defensive', label: 'Defensive' },
]

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
}

export function GameCanvas({
  onEditUnit,
  onEditTerrain,
  placementMode = false,
  onTableClick,
  showBases = true,
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
  /**
   * An entity being given a new place by tapping the water. Works like placing
   * a new ship: the tap is read off as a bearing from the origin ship. The
   * origin ship herself cannot be moved this way — she reads origin wherever
   * she is, so there is nothing to read the tap against.
   */
  const [relocating, setRelocating] = useState<{ kind: 'unit' | 'terrain'; id: string } | null>(null)
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
  const updateUnit = useGameStore((s) => s.updateUnit)
  const removeTerrain = useGameStore((s) => s.removeTerrain)
  const removeUnit = useGameStore((s) => s.removeUnit)
  const setOrigin = useGameStore((s) => s.setOrigin)

  // Either kind of pointer placement — a new ship, or an existing entity being
  // given a new place — turns a tap on the water into a position rather than
  // a selection.
  const pointerPlacing = placementMode || relocating !== null
  const pointerPlacingRef = useRef(pointerPlacing)
  const relocatingRef = useRef(relocating)
  const sizeRef = useRef({ w: 0, h: 0 })
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  // A drag only pans when it began on empty water — starting on a ship or a
  // terrain piece is a selection, not a pan.
  const panAllowedRef = useRef(false)
  const didPanRef = useRef(false)
  const viewportForRef = useRef<(w: number, h: number) => Viewport>(() => ({ scale: 1, offsetX: 0, offsetY: 0 }))
  const relocateToRef = useRef<(world: Point) => void>(() => {})
  const renderGridRef = useRef<() => void>(() => {})
  const renderTerrainRef = useRef<() => void>(() => {})
  const renderUnitsRef = useRef<() => void>(() => {})
  const renderOverlayRef = useRef<() => void>(() => {})

  useEffect(() => { pointerPlacingRef.current = pointerPlacing }, [pointerPlacing])
  useEffect(() => { relocatingRef.current = relocating }, [relocating])
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
    if (!pointerPlacing) return
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
        label: formatBearing(toBearing(pos, originRef.current)),
      })
    }
    el.addEventListener('pointermove', onMove)
    return () => {
      el.removeEventListener('pointermove', onMove)
      setPlacementCursorPos(null)
    }
  }, [pointerPlacing, screenToWorld])

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
      } else if (pointers.size === 1 && panAllowedRef.current) {
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
      const isMoving = relocating?.kind === 'terrain' && relocating.id === t.id

      const g = new Graphics()
      g.poly(sv.flatMap((v) => [v.x, v.y]))
      g.fill({ color: parseInt(c.fill.slice(1), 16), alpha: TERRAIN_FILL_ALPHA })
      g.stroke({
        color: isSelected || isMoving ? 0xffffff : parseInt(c.border.slice(1), 16),
        width: isSelected || isMoving ? 3 : TERRAIN_BORDER_WIDTH,
        alpha: 0.9,
      })
      g.eventMode = 'static'
      g.cursor = 'pointer'
      g.on('pointerdown', (e) => {
        if (pointerPlacingRef.current) return
        e.stopPropagation()
        panAllowedRef.current = false
        setSelectedTerrainId(t.id)
        setMenuPos({ x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
        setSelectedUnitId(null)
      })
      tc.addChild(g)
    }
  }, [currentGame, worldToScreen, selectedTerrainId, relocating])

  const renderUnits = useCallback(() => {
    const uc = unitsContainerRef.current
    if (!uc || !currentGame) return
    uc.removeChildren()
    const { w, h } = sizeRef.current
    if (!w || !h) return

    const { scale } = viewportFor(w, h)

    // Ships are drawn where the player last entered them, orders or no
    // orders: the app moves nothing itself.
    const units = currentGame.units

    for (const u of units) {
      const pos = worldToScreen(u.position.x, u.position.y, w, h)
      const container = new Container()
      container.x = pos.x
      container.y = pos.y
      container.rotation = (u.orientation * Math.PI / 16) - Math.PI / 2

      const isPlayer = u.side === 'player'
      const isDisabled = u.status === 'destroyed' || u.status === 'surrendered'
      const hullColor = isPlayer ? 0x3b82f6 : 0xef4444
      const isSelected = u.id === selectedUnitId || (relocating?.kind === 'unit' && relocating.id === u.id)

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
        if (pointerPlacingRef.current) return
        e.stopPropagation()
        panAllowedRef.current = false
        setSelectedUnitId(unitId)
        setSelectedTerrainId(null)
        setMenuPos(null)
      })

      container.addChild(g)
      uc.addChild(container)
    }
  }, [currentGame, worldToScreen, viewportFor, selectedUnitId, showBases, relocating])

  const renderOverlay = useCallback(() => {
    const oc = overlayContainerRef.current
    if (!oc || !currentGame) return
    oc.removeChildren()
    const { w, h } = sizeRef.current
    if (!w || !h) return

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

    const drawPlanPath = (u: typeof currentGame.units[number], plan: NonNullable<typeof u.aiOrder>, color: number) => {
      // The very walk that resolves the move draws it, so the track shows
      // the sideways jog of every corner pivot exactly where it will happen.
      // The track follows the middle of her stern edge — the point a model is
      // walked along the table by — though her bearing is measured to the
      // base centre.
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

      // The end marker sits on the same point the track was drawn through, so
      // it lands where the stern will be read off.
      const endPos = track[track.length - 1]
      const dot = new Graphics()
      dot.circle(endPos.x, endPos.y, 4)
      dot.fill({ color, alpha: 0.8 })
      oc.addChild(dot)
    }

    if (currentGame.phase === 'orders') {
      for (const u of currentGame.units) {
        const plan = turnOrderFor(u)
        if (plan) drawPlanPath(u, plan, 0xfbbf24)
      }
    }
  }, [currentGame, worldToScreen])

  /**
   * Put the entity being relocated where the water was tapped. The tap is read
   * as a bearing from the origin ship — the nearest of the 16 points and the
   * nearest millimetre — and laid back out from there, so what lands is
   * exactly what the form would show, not the raw tap.
   */
  const relocateTo = useCallback(
    (world: Point) => {
      if (!relocating) return
      const anchor = originRef.current
      const snapped = fromBearing(toBearing(world, anchor), anchor)
      const position = { x: Math.round(snapped.x), y: Math.round(snapped.y) }
      if (relocating.kind === 'unit') {
        updateUnit(relocating.id, { position })
      } else {
        updateTerrain(relocating.id, { center: position })
      }
      setRelocating(null)
      setSelectedUnitId(null)
      setSelectedTerrainId(null)
      setMenuPos(null)
    },
    [relocating, updateUnit, updateTerrain],
  )

  useEffect(() => { relocateToRef.current = relocateTo }, [relocateTo])
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
        if (pointerPlacingRef.current) {
          const { w: cw, h: ch } = sizeRef.current
          if (!cw || !ch) return
          // The table is infinite: any point the player can tap is valid.
          const pos = screenToWorldRef.current(e.global.x, e.global.y, cw, ch)
          if (relocatingRef.current) {
            relocateToRef.current(pos)
          } else {
            onTableClickRef.current?.(Math.round(pos.x), Math.round(pos.y))
          }
          return
        }
        setSelectedTerrainId(null)
        setMenuPos(null)
        setSelectedUnitId(null)
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
    hit.cursor = pointerPlacing ? 'crosshair' : 'grab'
  }, [pointerPlacing])

  const selectedTerrain = selectedTerrainId
    ? currentGame?.terrain.find((t) => t.id === selectedTerrainId)
    : undefined
  const selectedUnit = selectedUnitId
    ? currentGame?.units.find((u) => u.id === selectedUnitId)
    : undefined
  const lastShipWithTerrain =
    (currentGame?.units.length ?? 0) === 1 && (currentGame?.terrain.length ?? 0) > 0
  const relocatingName = relocating
    ? relocating.kind === 'unit'
      ? currentGame?.units.find((u) => u.id === relocating.id)?.name
      : (() => {
          const t = currentGame?.terrain.find((t) => t.id === relocating.id)
          return t ? `the ${TERRAIN_COLORS[t.type].label.toLowerCase()}` : undefined
        })()
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

      {relocating && (
        <div className="absolute inset-x-0 top-0 flex items-center justify-center pointer-events-none">
          <div className="bg-gray-900/90 border border-gray-700 rounded-b-lg px-4 py-2 flex items-center gap-3 pointer-events-auto backdrop-blur-sm">
            <span className="text-xs text-gray-300">
              Tap the water where {relocatingName ?? 'it'} now lies
              {relocating.kind === 'unit' ? ' (centre of the base)' : ' (centre)'}
            </span>
            <button
              onClick={() => setRelocating(null)}
              className="text-xs text-red-400 hover:text-red-300 border border-red-800 rounded px-2 py-1 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
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
            {formatBearing(toBearing(terrainReferencePoint(selectedTerrain), origin))}
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
                setRelocating({ kind: 'terrain', id: selectedTerrain.id })
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
              ? 'Origin — every bearing is measured from her'
              : formatBearing(toBearing(unitReferencePoint(selectedUnit), origin))}
          </div>
          <div className="text-xs text-gray-500 mb-3">
            Heading {COMPASS_LABELS[selectedUnit.orientation]} &middot; {ATTITUDE_LABELS[selectedUnit.attitude]}
          </div>

          {/* A quick way to bring a heading up to date without the form: one
              point either way, or the slider. Any change is a change to what
              the AI planned against, so it discards revealed orders. */}
          <div className="mb-3 border-t border-gray-800 pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-400">Heading</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => updateUnit(selectedUnit.id, { orientation: (selectedUnit.orientation + 31) % 32 })}
                  className="w-6 h-6 rounded border border-gray-700 text-gray-300 hover:text-white text-xs leading-none cursor-pointer"
                  aria-label="One point to port"
                  title="One point to port"
                >
                  &larr;
                </button>
                <span className="font-mono text-xs text-gray-200 w-10 text-center">{COMPASS_LABELS[selectedUnit.orientation]}</span>
                <button
                  type="button"
                  onClick={() => updateUnit(selectedUnit.id, { orientation: (selectedUnit.orientation + 1) % 32 })}
                  className="w-6 h-6 rounded border border-gray-700 text-gray-300 hover:text-white text-xs leading-none cursor-pointer"
                  aria-label="One point to starboard"
                  title="One point to starboard"
                >
                  &rarr;
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={31}
              value={selectedUnit.orientation}
              onChange={(e) => updateUnit(selectedUnit.id, { orientation: Number(e.target.value) })}
              className="w-full mt-1.5 cursor-pointer accent-blue-500"
              aria-label="Heading"
            />
            {/* An AI ship's style is as much a per-turn setting as her heading:
                a captain who has taken a beating turns cautious. Changing it
                discards revealed orders, since the AI would move differently. */}
            {selectedUnit.side === 'ai' && (
              <div className="flex items-center justify-between gap-2 mt-2">
                <span className="text-xs text-gray-400">Style</span>
                <Select<AIStyle>
                  value={selectedUnit.aiStyle}
                  onChange={(aiStyle) => updateUnit(selectedUnit.id, { aiStyle })}
                  size="sm"
                  className="w-28"
                  ariaLabel="AI style"
                  options={AI_STYLE_OPTIONS}
                />
              </div>
            )}
          </div>

          {currentGame?.originId !== selectedUnit.id && (
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setRelocating({ kind: 'unit', id: selectedUnit.id })}
                title="Tap the water where she now lies; the tap is read as a bearing from the origin ship"
                className="flex-1 text-xs text-blue-400 hover:text-blue-300 border border-blue-800 rounded px-2 py-1.5 transition-colors cursor-pointer"
              >
                Move
              </button>
              <button
                onClick={() => setOrigin(selectedUnit.id)}
                className="flex-1 text-xs text-sky-400 hover:text-sky-300 border border-sky-800 rounded px-2 py-1.5 transition-colors cursor-pointer"
              >
                Set as origin
              </button>
            </div>
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
                if (removeUnit(selectedUnit.id)) setSelectedUnitId(null)
              }}
              disabled={lastShipWithTerrain}
              title={lastShipWithTerrain ? 'The terrain is measured from this ship; remove the terrain first' : 'Remove this ship from the game'}
              className="flex-1 text-xs text-red-400 hover:text-red-300 border border-red-800 rounded px-2 py-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {pointerPlacing && placementCursorPos && (
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
