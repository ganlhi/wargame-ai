import { useRef, useEffect, useCallback, useState } from 'react'
import { Application, Graphics, Container } from 'pixi.js'
import { useGameStore } from '../stores/gameStore'
import { TERRAIN_COLORS } from './TerrainPanel'
import type { GameState, TerrainType, UnitStatus } from '../types'
import { arcSideToAngles } from '../types'
import { computeAttitude, ATTITUDE_LABELS, COMPASS_LABELS } from '../utils/attitude'
import { orientationToVector } from '../game/movement'
import type { Point } from '../utils/geometry'
import { baseCorners, terrainPolygon } from '../utils/geometry'
import {
  formatOffset, originPoint, terrainReferencePoint, toOffset, unitReferencePoint,
} from '../utils/coordinates'

const GRID_COLOR = 0xffffff
const GRID_ALPHA = 0.06
const ORIGIN_COLOR = 0x38bdf8

const TERRAIN_FILL_ALPHA = 0.35
const TERRAIN_BORDER_WIDTH = 2

const PADDING = 28

/**
 * The table is infinite, so the view frames whatever is actually in play rather
 * than a fixed rectangle. `MIN_SPAN` stops a lone ship from being magnified to
 * absurdity, and `CONTENT_MARGIN` keeps content off the very edge of the canvas.
 */
const MIN_SPAN = 800
const CONTENT_MARGIN = 150

/** Grid spacings tried in order; the first that isn't visually dense wins. */
const GRID_STEPS = [50, 100, 250, 500, 1000, 2500, 5000]
const MAX_GRID_LINES = 40

interface Viewport {
  scale: number
  offsetX: number
  offsetY: number
}

/**
 * Every world point the view needs to show: ship bases, terrain outlines, the
 * origin, and any movement path currently previewed (so a plan is never drawn
 * off-screen).
 */
function contentPoints(game: GameState): Point[] {
  const pts: Point[] = [originPoint(game)]

  for (const t of game.terrain) {
    pts.push(...terrainPolygon(t))
  }

  for (const u of game.units) {
    if (u.baseWidth > 0 && u.baseLength > 0) {
      pts.push(...baseCorners(u.position, u.orientation, u.baseWidth, u.baseLength))
    } else {
      pts.push(u.position)
    }

    const plan = u.hiddenAIOrder ?? u.playerOrder
    if (!plan) continue
    let orient = u.orientation
    let p = { ...u.position }
    for (const chunk of plan.chunks) {
      if (u.isInIrons) {
        const driftAngle = (((game.windDirection + 8) % 32) * Math.PI) / 16 - Math.PI / 2
        p = {
          x: p.x + Math.cos(driftAngle) * ((u.driftSpeed ?? 10) / 5),
          y: p.y + Math.sin(driftAngle) * ((u.driftSpeed ?? 10) / 5),
        }
      } else {
        const vec = orientationToVector(orient)
        p = { x: p.x + vec.dx * chunk.distance, y: p.y + vec.dy * chunk.distance }
      }
      pts.push(p)
      if (chunk.turn) {
        orient = (orient + (chunk.turn.direction === 'starboard' ? chunk.turn.points : -chunk.turn.points) + 32) % 32
      }
    }
  }

  return pts
}

function computeViewport(game: GameState | null, w: number, h: number): Viewport {
  if (!game || w <= 0 || h <= 0) return { scale: 1, offsetX: 0, offsetY: 0 }

  const pts = contentPoints(game)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX)) {
    minX = maxX = minY = maxY = 0
  }

  minX -= CONTENT_MARGIN
  minY -= CONTENT_MARGIN
  maxX += CONTENT_MARGIN
  maxY += CONTENT_MARGIN

  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const spanX = Math.max(maxX - minX, MIN_SPAN)
  const spanY = Math.max(maxY - minY, MIN_SPAN)

  const scale = Math.min((w - PADDING * 2) / spanX, (h - PADDING * 2) / spanY)
  return { scale, offsetX: w / 2 - cx * scale, offsetY: h / 2 - cy * scale }
}

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
}

export function GameCanvas({
  onEditUnit,
  onEditTerrain,
  placementMode = false,
  onTableClick,
  showBases = false,
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

  const viewportFor = useCallback(
    (w: number, h: number) => computeViewport(currentGame, w, h),
    [currentGame],
  )

  const worldToScreen = useCallback(
    (wx: number, wy: number, w: number, h: number) => {
      const v = viewportFor(w, h)
      return { x: wx * v.scale + v.offsetX, y: wy * v.scale + v.offsetY }
    },
    [viewportFor],
  )

  const screenToWorld = useCallback(
    (sx: number, sy: number, w: number, h: number) => {
      const v = viewportFor(w, h)
      return { x: (sx - v.offsetX) / v.scale, y: (sy - v.offsetY) / v.scale }
    },
    [viewportFor],
  )

  const screenToWorldRef = useRef(screenToWorld)
  useEffect(() => { screenToWorldRef.current = screenToWorld }, [screenToWorld])

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

    // Grapple link lines, drawn first so the ship icons sit on top. One line per
    // pair (dedup via sorted id key) connecting the two grappled units.
    const drawnLinks = new Set<string>()
    for (const u of currentGame.units) {
      if (!u.grappledWith) continue
      const partner = currentGame.units.find((p) => p.id === u.grappledWith)
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

    for (const u of currentGame.units) {
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
        setSelectedUnitId(unitId)
        setSelectedTerrainId(null)
        setMenuPos(null)
      })

      container.addChild(g)
      uc.addChild(container)
    }
  }, [currentGame, worldToScreen, viewportFor, selectedUnitId, showBases])

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

    const windAngle = (currentGame.windDirection + 8) * Math.PI / 16
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
      const startPos = worldToScreen(u.position.x, u.position.y, w, h)
      let ox = u.orientation
      let px = u.position.x
      let py = u.position.y

      const pathG = new Graphics()
      pathG.moveTo(startPos.x, startPos.y)

      for (const chunk of plan.chunks) {
        if (u.isInIrons) {
          const driftDir = (currentGame.windDirection + 8) % 32
          const driftAngle = (driftDir * Math.PI / 16) - Math.PI / 2
          // driftSpeed is the total drift for a whole turn, split across the 5 chunks.
          const driftPerChunk = (u.driftSpeed ?? 10) / 5
          px += Math.cos(driftAngle) * driftPerChunk
          py += Math.sin(driftAngle) * driftPerChunk
        } else {
          const vecAngle = (ox * Math.PI / 16) - Math.PI / 2
          px += Math.cos(vecAngle) * chunk.distance
          py += Math.sin(vecAngle) * chunk.distance
        }
        const sp = worldToScreen(px, py, w, h)
        pathG.lineTo(sp.x, sp.y)

        if (chunk.turn) {
          ox = (ox + (chunk.turn.direction === 'starboard' ? chunk.turn.points : -chunk.turn.points) + 32) % 32
        }
      }

      pathG.stroke({ color, width: 2, alpha: 0.6 })
      oc.addChild(pathG)

      const endPos = worldToScreen(px, py, w, h)
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
      const plan = selectedUnit.hiddenAIOrder
      const firePlan = selectedUnit.hiddenAIFirePlan

      if (plan && firePlan) {
        const pos = { ...selectedUnit.position }
        let orient = selectedUnit.orientation
        for (let ci = 0; ci <= firePlan.chunkIndex && ci < plan.chunks.length; ci++) {
          const chunk = plan.chunks[ci]
          const vec = orientationToVector(orient)
          pos.x += vec.dx * chunk.distance
          pos.y += vec.dy * chunk.distance
          if (chunk.turn) {
            const dir = chunk.turn.direction === 'port' ? -1 : 1
            orient = (orient + dir * chunk.turn.points + 32) % 32
          }
        }

        const firingPos = worldToScreen(pos.x, pos.y, w, h)
        const firingOrientDeg = orient * 360 / 32
        const arc = selectedUnit.firingArcs.find((a) => a.side === firePlan.arcSide)
        if (arc) {
          const a = arcSideToAngles(arc.side)
          const worldMin = ((firingOrientDeg + a.minAngle) % 360 + 360) % 360
          const worldMax = ((firingOrientDeg + a.maxAngle) % 360 + 360) % 360
          const radius = arc.maxRange * scale
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
      hit.on('pointerdown', (e) => {
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
    hit.cursor = placementMode ? 'crosshair' : 'default'
  }, [placementMode])

  const selectedTerrain = selectedTerrainId
    ? currentGame?.terrain.find((t) => t.id === selectedTerrainId)
    : undefined
  const selectedUnit = selectedUnitId
    ? currentGame?.units.find((u) => u.id === selectedUnitId)
    : undefined
  const terrainTypes: TerrainType[] = ['island', 'shoal', 'reef']

  return (
    <div className="flex flex-col flex-1 relative">
      <div ref={containerRef} className="flex-1" />

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
            <select
              value={selectedTerrain.type}
              onChange={(e) => updateTerrain(selectedTerrain.id, { type: e.target.value as TerrainType })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
            >
              {terrainTypes.map((type) => (
                <option key={type} value={type}>
                  {TERRAIN_COLORS[type].label}
                </option>
              ))}
            </select>
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
            Orientation: {COMPASS_LABELS[selectedUnit.orientation]} &middot; Attitude: {currentGame ? ATTITUDE_LABELS[computeAttitude(currentGame.windDirection, selectedUnit.orientation)] : ''}
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
                    <select
                      value=""
                      onChange={(e) => e.target.value && setGrapple(selectedUnit.id, e.target.value)}
                      className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="">Select a ship…</option>
                      {candidates.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
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
