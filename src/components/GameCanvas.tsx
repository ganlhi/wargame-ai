import { useRef, useEffect, useCallback, useState } from 'react'
import { Application, Graphics, Container, Sprite, Texture } from 'pixi.js'
import { useGameStore } from '../stores/gameStore'
import { TERRAIN_COLORS } from './TerrainPanel'
import type { TerrainType, UnitStatus } from '../types'
import { arcSideToAngles } from '../types'
import { computeAttitude, ATTITUDE_LABELS, COMPASS_LABELS } from '../utils/attitude'
import { orientationToVector } from '../game/movement'

const GRID_COLOR = 0xffffff
const GRID_ALPHA = 0.06
const GRID_SIZE = 50

const TERRAIN_FILL_ALPHA = 0.35
const TERRAIN_BORDER_WIDTH = 2
const VERTEX_RADIUS = 6
const VERTEX_COLOR = 0x3b82f6
const VERTEX_ACTIVE_COLOR = 0x60a5fa

const PADDING = 20

interface GameCanvasProps {
  editingTerrain: boolean
  onFinishEdit: (vertices: { x: number; y: number }[]) => void
  onCancelEdit: () => void
  onEditUnit?: (unitId: string) => void
  placementMode?: boolean
  onTableClick?: (tableX: number, tableY: number) => void
}

export function GameCanvas({ editingTerrain, onFinishEdit, onCancelEdit, onEditUnit, placementMode = false, onTableClick }: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const initialized = useRef(false)
  const bgContainerRef = useRef<Container | null>(null)
  const gridContainerRef = useRef<Container | null>(null)
  const terrainContainerRef = useRef<Container | null>(null)
  const editContainerRef = useRef<Container | null>(null)
  const unitsContainerRef = useRef<Container | null>(null)
  const overlayContainerRef = useRef<Container | null>(null)
  const [tempVertices, setTempVertices] = useState<{ x: number; y: number }[]>([])
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)

  const [placementCursorPos, setPlacementCursorPos] = useState<{ screenX: number; screenY: number; tableX: number; tableY: number } | null>(null)
  const [moveTerrainId, setMoveTerrainId] = useState<string | null>(null)
  const [moveVertices, setMoveVertices] = useState<{ x: number; y: number }[]>([])
  const [editTerrainId, setEditTerrainId] = useState<string | null>(null)
  const [editVertices, setEditVertices] = useState<{ x: number; y: number }[]>([])
  const draggingVertex = useRef<number | null>(null)
  const editingTerrainRef = useRef(editingTerrain)
  const placementModeRef = useRef(placementMode)
  const currentGame = useGameStore((s) => s.currentGame)
  const updateTerrain = useGameStore((s) => s.updateTerrain)
  const removeTerrain = useGameStore((s) => s.removeTerrain)
  const removeUnit = useGameStore((s) => s.removeUnit)
  const sizeRef = useRef({ w: 0, h: 0 })
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const backgroundGenRef = useRef(0)
  const handleDragRef = useRef<(sx: number, sy: number) => void>(() => {})
  const moveDragStart = useRef<{ tableX: number; tableY: number } | null>(null)
  const moveOrigVerts = useRef<{ x: number; y: number }[]>([])
  const editDragIdx = useRef<number | null>(null)
  const renderBackgroundRef = useRef<() => void>(() => {})
  const renderGridRef = useRef<() => void>(() => {})
  const renderTerrainRef = useRef<() => void>(() => {})
  const renderUnitsRef = useRef<() => void>(() => {})
  const renderOverlayRef = useRef<() => void>(() => {})

  useEffect(() => {
    editingTerrainRef.current = editingTerrain
  }, [editingTerrain])
  useEffect(() => { placementModeRef.current = placementMode }, [placementMode])
  const onTableClickRef = useRef(onTableClick)
  useEffect(() => { onTableClickRef.current = onTableClick }, [onTableClick])

  const getSize = useCallback(() => {
    const el = containerRef.current
    if (!el) return { w: 0, h: 0 }
    return { w: el.clientWidth, h: el.clientHeight }
  }, [])

  const tableToScreen = useCallback(
    (tx: number, ty: number, w: number, h: number) => {
      if (!currentGame) return { x: tx, y: ty }
      const sx = (w - PADDING * 2) / currentGame.tableWidth
      const sy = (h - PADDING * 2) / currentGame.tableHeight
      const s = Math.min(sx, sy)
      const ox = (w - currentGame.tableWidth * s) / 2
      const oy = (h - currentGame.tableHeight * s) / 2
      return { x: tx * s + ox, y: ty * s + oy }
    },
    [currentGame]
  )

  const screenToTable = useCallback(
    (sx: number, sy: number, w: number, h: number) => {
      if (!currentGame) return { x: sx, y: sy }
      const sxScale = (w - PADDING * 2) / currentGame.tableWidth
      const syScale = (h - PADDING * 2) / currentGame.tableHeight
      const s = Math.min(sxScale, syScale)
      const ox = (w - currentGame.tableWidth * s) / 2
      const oy = (h - currentGame.tableHeight * s) / 2
      return { x: (sx - ox) / s, y: (sy - oy) / s }
    },
    [currentGame]
  )

  const screenToTableRef = useRef(screenToTable)
  useEffect(() => {
    screenToTableRef.current = screenToTable
  }, [screenToTable])

  useEffect(() => {
    if (!placementMode) return
    const el = containerRef.current
    if (!el) return
    const onMove = (e: PointerEvent) => {
      if (!currentGame) return
      const rect = el.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const { w, h } = sizeRef.current
      if (!w || !h) return
      const pos = screenToTable(sx, sy, w, h)
      if (pos.x >= 0 && pos.x <= currentGame.tableWidth && pos.y >= 0 && pos.y <= currentGame.tableHeight) {
        setPlacementCursorPos({ screenX: e.clientX, screenY: e.clientY, tableX: Math.round(pos.x), tableY: Math.round(pos.y) })
      } else {
        setPlacementCursorPos(null)
      }
    }
    el.addEventListener('pointermove', onMove)
    return () => el.removeEventListener('pointermove', onMove)
  }, [placementMode, currentGame, screenToTable])

  const handleDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (draggingVertex.current === null || !currentGame) return
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = clientX - rect.left
      const y = clientY - rect.top
      const { w, h } = sizeRef.current
      if (!w || !h) return
      const pos = screenToTableRef.current(x, y, w, h)
      if (pos.x < 0 || pos.x > currentGame.tableWidth || pos.y < 0 || pos.y > currentGame.tableHeight) return
      setTempVertices((prev) => {
        const next = [...prev]
        next[draggingVertex.current!] = { x: Math.round(pos.x), y: Math.round(pos.y) }
        return next
      })
    },
    [currentGame]
  )

  const renderTerrain = useCallback(() => {
    const tc = terrainContainerRef.current
    if (!tc || !currentGame) return
    tc.removeChildren()
    const { w, h } = sizeRef.current
    if (!w || !h) return

    for (const t of currentGame.terrain) {
      if (t.vertices.length < 3) continue

      let vertices = t.vertices
      if (t.id === moveTerrainId && moveVertices.length > 0) {
        vertices = moveVertices
      } else if (t.id === editTerrainId && editVertices.length > 0) {
        vertices = editVertices
      }

      const sv = vertices.map((v) => tableToScreen(v.x, v.y, w, h))
      const c = TERRAIN_COLORS[t.type]
      const g = new Graphics()
      const isSelected = t.id === selectedTerrainId
      const isMoveOrEdit = t.id === moveTerrainId || t.id === editTerrainId
      g.poly(sv.flatMap((v) => [v.x, v.y]))
      g.fill({ color: parseInt(c.fill.slice(1), 16), alpha: TERRAIN_FILL_ALPHA })
      g.stroke({ color: isSelected || isMoveOrEdit ? 0xffffff : parseInt(c.border.slice(1), 16), width: isSelected || isMoveOrEdit ? 3 : TERRAIN_BORDER_WIDTH, alpha: 0.9 })
      g.eventMode = 'static'
      g.cursor = isMoveOrEdit ? 'grab' : 'pointer'
      const terrainId = t.id
      g.on('pointerdown', (e) => {
        if (editingTerrainRef.current || placementModeRef.current) return
        e.stopPropagation()

        if (t.id === moveTerrainId) {
          const pos = screenToTableRef.current(e.global.x, e.global.y, w, h)
          moveDragStart.current = { tableX: pos.x, tableY: pos.y }
          moveOrigVerts.current = [...moveVertices]
          const onMove = (ev: PointerEvent) => handleMoveDragRef.current(ev.clientX, ev.clientY)
          const onUp = (ev: PointerEvent) => {
            if (moveDragStart.current && moveTerrainId && currentGame) {
              const rect = containerRef.current!.getBoundingClientRect()
              const { w: cw, h: ch } = sizeRef.current
              if (cw && ch) {
                const finalPos = screenToTableRef.current(ev.clientX - rect.left, ev.clientY - rect.top, cw, ch)
                const dx = Math.round(finalPos.x - moveDragStart.current.tableX)
                const dy = Math.round(finalPos.y - moveDragStart.current.tableY)
                updateTerrain(moveTerrainId, {
                  vertices: moveOrigVerts.current.map((v) => ({
                    x: Math.max(0, Math.min(currentGame.tableWidth, v.x + dx)),
                    y: Math.max(0, Math.min(currentGame.tableHeight, v.y + dy)),
                  }))
                })
              }
            }
            moveDragStart.current = null
            setMoveTerrainId(null)
            setMoveVertices([])
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          return
        }

        if (t.id === editTerrainId) return

        setSelectedTerrainId(terrainId)
        setMenuPos({ x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
        setSelectedUnitId(null)
        setUnitMenuPos(null)
      })
      tc.addChild(g)
    }

    if (editTerrainId && editVertices.length > 0) {
      const sv = editVertices.map((v) => tableToScreen(v.x, v.y, w, h))
      sv.forEach((v, i) => {
        const dot = new Graphics()
        dot.circle(v.x, v.y, VERTEX_RADIUS)
        dot.fill({ color: VERTEX_COLOR })
        dot.stroke({ color: 0xffffff, width: 2, alpha: 0.8 })
        dot.eventMode = 'static'
        dot.cursor = 'grab'
        const idx = i
        dot.on('pointerdown', (e) => {
          e.stopPropagation()
          editDragIdx.current = idx
          const onMove = (ev: PointerEvent) => handleEditDragRef.current(ev.clientX, ev.clientY)
          const onUp = () => {
            editDragIdx.current = null
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
        })
        tc.addChild(dot)
      })
    }
  }, [currentGame, tableToScreen, selectedTerrainId, moveTerrainId, moveVertices, editTerrainId, editVertices, updateTerrain])

  const renderEditingState = useCallback(() => {
    const ec = editContainerRef.current
    if (!ec) return
    ec.removeChildren()
    if (tempVertices.length === 0) return

    const { w, h } = sizeRef.current
    if (!w || !h) return
    const sv = tempVertices.map((v) => tableToScreen(v.x, v.y, w, h))

    const poly = new Graphics()
    poly.poly(sv.flatMap((v) => [v.x, v.y]))
    poly.fill({ color: VERTEX_COLOR, alpha: 0.15 })
    poly.stroke({ color: VERTEX_COLOR, width: 2, alpha: 0.6 })
    ec.addChild(poly)

    sv.forEach((v, i) => {
      const dot = new Graphics()
      dot.circle(v.x, v.y, VERTEX_RADIUS)
      dot.fill({ color: i === sv.length - 1 ? VERTEX_ACTIVE_COLOR : VERTEX_COLOR })
      dot.stroke({ color: 0xffffff, width: 2, alpha: 0.8 })
      dot.eventMode = 'static'
      dot.cursor = 'grab'
      const idx = i
      dot.on('pointerdown', (e) => {
        e.stopPropagation()
        draggingVertex.current = idx
        const onMove = (ev: PointerEvent) => handleDragRef.current(ev.clientX, ev.clientY)
        const onUp = () => {
          draggingVertex.current = null
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      })
      ec.addChild(dot)
    })
  }, [tempVertices, tableToScreen])

  const getStatusColor = (status: UnitStatus): number | null => {
    switch (status) {
      case 'grappled': return 0xf59e0b
      case 'immobilised': return 0xeab308
      case 'destroyed': return 0x6b7280
      case 'surrendered': return 0xffffff
      default: return null
    }
  }

  const renderUnits = useCallback(() => {
    const uc = unitsContainerRef.current
    if (!uc || !currentGame) return
    uc.removeChildren()
    const { w, h } = sizeRef.current
    if (!w || !h) return

    for (const u of currentGame.units) {
      const pos = tableToScreen(u.position.x, u.position.y, w, h)
      const container = new Container()
      container.x = pos.x
      container.y = pos.y
      container.rotation = (u.orientation * Math.PI / 16) - Math.PI / 2

      const isPlayer = u.side === 'player'
      const isDisabled = u.status === 'destroyed' || u.status === 'surrendered'
      const hullColor = isPlayer ? 0x3b82f6 : 0xef4444
      const isSelected = u.id === selectedUnitId

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
        if (editingTerrainRef.current || placementModeRef.current) return
        e.stopPropagation()
        setSelectedUnitId(unitId)
        setSelectedTerrainId(null)
        setMenuPos(null)
      })

      container.addChild(g)
      uc.addChild(container)
    }
  }, [currentGame, tableToScreen, selectedUnitId])

  const renderOverlay = useCallback(() => {
    const oc = overlayContainerRef.current
    if (!oc || !currentGame) return
    oc.removeChildren()
    const { w, h } = sizeRef.current
    if (!w || !h) return

    const sx = (w - PADDING * 2) / currentGame.tableWidth
    const sy = (h - PADDING * 2) / currentGame.tableHeight
    const s = Math.min(sx, sy)
    const ox = (w - currentGame.tableWidth * s) / 2
    const oy = (h - currentGame.tableHeight * s) / 2

    const compassR = 16
    const cx = ox + PADDING + compassR + 8
    const cy = oy + currentGame.tableHeight * s - PADDING - compassR - 8

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

    g.moveTo(cx, cy)
    g.lineTo(cx + compassR * Math.cos(S), cy + compassR * Math.sin(S))
    g.stroke({ color: 0xffffff, width: 1, alpha: 0.25 })

    g.moveTo(cx, cy)
    g.lineTo(cx + compassR * Math.cos(E), cy + compassR * Math.sin(E))
    g.stroke({ color: 0xffffff, width: 1, alpha: 0.25 })

    g.moveTo(cx, cy)
    g.lineTo(cx + compassR * Math.cos(W), cy + compassR * Math.sin(W))
    g.stroke({ color: 0xffffff, width: 1, alpha: 0.25 })

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
      const startPos = tableToScreen(u.position.x, u.position.y, w, h)
      let ox = u.orientation
      let px = u.position.x
      let py = u.position.y

      const pathG = new Graphics()
      pathG.moveTo(startPos.x, startPos.y)

      for (const chunk of plan.chunks) {
        if (u.isInIrons) {
          const driftDir = (currentGame.windDirection + 8) % 32
          const driftAngle = (driftDir * Math.PI / 16) - Math.PI / 2
          px += Math.cos(driftAngle) * (u.driftSpeed ?? 10)
          py += Math.sin(driftAngle) * (u.driftSpeed ?? 10)
        } else {
          const vecAngle = (ox * Math.PI / 16) - Math.PI / 2
          px += Math.cos(vecAngle) * chunk.distance
          py += Math.sin(vecAngle) * chunk.distance
        }
        const sp = tableToScreen(px, py, w, h)
        pathG.lineTo(sp.x, sp.y)

        if (chunk.turn) {
          ox = (ox + (chunk.turn.direction === 'starboard' ? chunk.turn.points : -chunk.turn.points) + 32) % 32
        }
      }

      pathG.stroke({ color, width: 2, alpha: 0.6 })
      oc.addChild(pathG)

      const endPos = tableToScreen(px, py, w, h)
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
        let pos = { ...selectedUnit.position }
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

        const firingPos = tableToScreen(pos.x, pos.y, w, h)
        const firingOrientDeg = orient * 360 / 32
        const arc = selectedUnit.firingArcs.find((a) => a.side === firePlan.arcSide)
        if (arc) {
          const a = arcSideToAngles(arc.side)
          const worldMin = ((firingOrientDeg + a.minAngle) % 360 + 360) % 360
          const worldMax = ((firingOrientDeg + a.maxAngle) % 360 + 360) % 360
          const radius = arc.maxRange * s
          const toScreenAngle = (deg: number) => (deg - 90) * Math.PI / 180
          const steps = 16
          const color = 0x22c55e

          const wedge = new Graphics()
          if (worldMin <= worldMax) {
            wedge.moveTo(firingPos.x, firingPos.y)
            wedge.lineTo(firingPos.x + Math.cos(toScreenAngle(worldMin)) * radius, firingPos.y + Math.sin(toScreenAngle(worldMin)) * radius)
            for (let i = 1; i <= steps; i++) {
              const angle = worldMin + (worldMax - worldMin) * (i / steps)
              wedge.lineTo(firingPos.x + Math.cos(toScreenAngle(angle)) * radius, firingPos.y + Math.sin(toScreenAngle(angle)) * radius)
            }
            wedge.closePath()
          } else {
            wedge.moveTo(firingPos.x, firingPos.y)
            wedge.lineTo(firingPos.x + Math.cos(toScreenAngle(worldMin)) * radius, firingPos.y + Math.sin(toScreenAngle(worldMin)) * radius)
            for (let i = 1; i <= steps; i++) {
              const angle = worldMin + (360 + worldMax - worldMin) * (i / steps)
              const a2 = angle >= 360 ? angle - 360 : angle
              wedge.lineTo(firingPos.x + Math.cos(toScreenAngle(a2)) * radius, firingPos.y + Math.sin(toScreenAngle(a2)) * radius)
            }
            wedge.closePath()
          }
          wedge.fill({ color, alpha: 0.15 })
          wedge.stroke({ color, width: 1.5, alpha: 0.4 })
          oc.addChild(wedge)

          const border = new Graphics()
          const toA = toScreenAngle(worldMin)
          border.moveTo(firingPos.x, firingPos.y)
          border.lineTo(firingPos.x + Math.cos(toA) * radius, firingPos.y + Math.sin(toA) * radius)
          const toB = toScreenAngle(worldMax)
          border.moveTo(firingPos.x, firingPos.y)
          border.lineTo(firingPos.x + Math.cos(toB) * radius, firingPos.y + Math.sin(toB) * radius)
          border.stroke({ color, width: 1, alpha: 0.5 })
          oc.addChild(border)

          const arcSteps = 24
          const arcG = new Graphics()
          const aStart = toScreenAngle(worldMin)
          const aEnd = toScreenAngle(worldMax)
          let sweep = aEnd - aStart
          if (sweep < 0) sweep += Math.PI * 2
          arcG.arc(firingPos.x, firingPos.y, radius, aStart, aStart + sweep)
          arcG.stroke({ color, width: 1.5, alpha: 0.3 })
          oc.addChild(arcG)
        }
      }
    }
  }, [currentGame, tableToScreen, selectedUnitId])

  const renderBackground = useCallback(() => {
    const bc = bgContainerRef.current
    if (!bc || !currentGame) return
    bc.removeChildren()
    const { w, h } = sizeRef.current
    if (!w || !h) return
    const sx = (w - PADDING * 2) / currentGame.tableWidth
    const sy = (h - PADDING * 2) / currentGame.tableHeight
    const s = Math.min(sx, sy)
    const ox = (w - currentGame.tableWidth * s) / 2
    const oy = (h - currentGame.tableHeight * s) / 2

    if (currentGame.backgroundImage) {
      const gen = ++backgroundGenRef.current
      const img = new window.Image()
      img.onload = () => {
        if (backgroundGenRef.current !== gen) return
        const texture = Texture.from(img)
        const sprite = new Sprite(texture)
        sprite.x = ox
        sprite.y = oy
        sprite.width = currentGame.tableWidth * s
        sprite.height = currentGame.tableHeight * s
        sprite.alpha = 0.6
        bc.addChild(sprite)
      }
      img.src = currentGame.backgroundImage
    }

    if (!currentGame.backgroundImage) {
      const bg = new Graphics()
      bg.rect(PADDING, PADDING, w - PADDING * 2, h - PADDING * 2)
      bg.fill({ color: 0x1a1a2e, alpha: 0.95 })
      bc.addChild(bg)
    }
  }, [currentGame])

  const renderGrid = useCallback(() => {
    const gc = gridContainerRef.current
    if (!gc || !currentGame) return
    gc.removeChildren()
    const { w, h } = sizeRef.current
    if (!w || !h) return
    const sx = (w - PADDING * 2) / currentGame.tableWidth
    const sy = (h - PADDING * 2) / currentGame.tableHeight
    const s = Math.min(sx, sy)
    const ox = (w - currentGame.tableWidth * s) / 2
    const oy = (h - currentGame.tableHeight * s) / 2

    const grid = new Graphics()
    for (let x = 0; x <= currentGame.tableWidth; x += GRID_SIZE) {
      const px = ox + x * s
      grid.moveTo(px, oy)
      grid.lineTo(px, oy + currentGame.tableHeight * s)
    }
    for (let y = 0; y <= currentGame.tableHeight; y += GRID_SIZE) {
      const py = oy + y * s
      grid.moveTo(ox, py)
      grid.lineTo(ox + currentGame.tableWidth * s, py)
    }
    grid.stroke({ color: GRID_COLOR, width: 1, alpha: GRID_ALPHA })
    gc.addChild(grid)
  }, [currentGame])

  const addVertex = useCallback(
    (screenX: number, screenY: number) => {
      if (!currentGame) return
      const { w, h } = sizeRef.current
      if (!w || !h) return
      const pos = screenToTable(screenX, screenY, w, h)
      if (pos.x < 0 || pos.x > currentGame.tableWidth || pos.y < 0 || pos.y > currentGame.tableHeight) return
      setTempVertices((prev) => [...prev, { x: Math.round(pos.x), y: Math.round(pos.y) }])
    },
    [currentGame, screenToTable]
  )

  const handleMoveDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (!moveDragStart.current || !moveTerrainId || !currentGame) return
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const { w, h } = sizeRef.current
      if (!w || !h) return
      const pos = screenToTableRef.current(clientX - rect.left, clientY - rect.top, w, h)
      const dx = Math.round(pos.x - moveDragStart.current.tableX)
      const dy = Math.round(pos.y - moveDragStart.current.tableY)
      setMoveVertices(
        moveOrigVerts.current.map((v) => ({
          x: Math.max(0, Math.min(currentGame.tableWidth, v.x + dx)),
          y: Math.max(0, Math.min(currentGame.tableHeight, v.y + dy)),
        }))
      )
    },
    [currentGame, moveTerrainId]
  )

  const handleEditDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (editDragIdx.current === null || !editTerrainId || !currentGame) return
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const { w, h } = sizeRef.current
      if (!w || !h) return
      const pos = screenToTableRef.current(clientX - rect.left, clientY - rect.top, w, h)
      if (pos.x < 0 || pos.x > currentGame.tableWidth || pos.y < 0 || pos.y > currentGame.tableHeight) return
      setEditVertices((prev) => {
        const next = [...prev]
        next[editDragIdx.current!] = { x: Math.round(pos.x), y: Math.round(pos.y) }
        return next
      })
    },
    [currentGame, editTerrainId]
  )

  const handleMoveDragRef = useRef(handleMoveDrag)
  useEffect(() => { handleMoveDragRef.current = handleMoveDrag }, [handleMoveDrag])
  const handleEditDragRef = useRef(handleEditDrag)
  useEffect(() => { handleEditDragRef.current = handleEditDrag }, [handleEditDrag])
  useEffect(() => { handleDragRef.current = handleDrag }, [handleDrag])
  useEffect(() => { renderBackgroundRef.current = renderBackground }, [renderBackground])
  useEffect(() => { renderGridRef.current = renderGrid }, [renderGrid])
  useEffect(() => { renderTerrainRef.current = renderTerrain }, [renderTerrain])
  useEffect(() => { renderUnitsRef.current = renderUnits }, [renderUnits])
  useEffect(() => { renderOverlayRef.current = renderOverlay }, [renderOverlay])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    if (initialized.current) {
      renderBackground()
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

      const bg = new Container()
      const grid = new Container()
      const terrain = new Container()
      const units = new Container()
      const edit = new Container()
      const overlay = new Container()
      app.stage.addChild(bg, grid, terrain, units, edit, overlay)
      bgContainerRef.current = bg
      gridContainerRef.current = grid
      terrainContainerRef.current = terrain
      unitsContainerRef.current = units
      editContainerRef.current = edit
      overlayContainerRef.current = overlay

      const hit = new Graphics()
      const drawHit = () => {
        hit.clear()
        hit.rect(0, 0, sizeRef.current.w, sizeRef.current.h)
        hit.fill({ color: 0x000000, alpha: 0.001 })
      }
      drawHit()
      hit.eventMode = 'static'
      hit.cursor = 'crosshair'
      hit.on('pointerdown', (e) => {
        if (editingTerrainRef.current && !draggingVertex.current) addVertex(e.global.x, e.global.y)
        if (placementModeRef.current && onTableClickRef.current && currentGame) {
          const { w, h } = sizeRef.current
          if (w && h) {
            const pos = screenToTableRef.current(e.global.x, e.global.y, w, h)
            if (pos.x >= 0 && pos.x <= currentGame.tableWidth && pos.y >= 0 && pos.y <= currentGame.tableHeight) {
              onTableClickRef.current(Math.round(pos.x), Math.round(pos.y))
            }
          }
          return
        }
        if (!editingTerrainRef.current && !moveDragStart.current && editDragIdx.current === null) {
          setSelectedTerrainId(null)
          setMenuPos(null)
          setSelectedUnitId(null)
          setUnitMenuPos(null)
          setMoveTerrainId(null)
          setMoveVertices([])
          setEditTerrainId(null)
          setEditVertices([])
        }
      })
      app.stage.addChildAt(hit, 0)

      const ro = new ResizeObserver(() => {
        const { w: newW, h: newH } = getSize()
        if (newW && newH) {
          app.renderer.resize(newW, newH)
          sizeRef.current = { w: newW, h: newH }
          drawHit()
          renderBackgroundRef.current()
          renderGridRef.current()
          renderTerrainRef.current()
          renderUnitsRef.current()
          renderOverlayRef.current()
        }
      })
      ro.observe(el)
      resizeObserverRef.current = ro

      renderBackgroundRef.current()
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

  useEffect(() => {
    renderBackground()
  }, [renderBackground])

  useEffect(() => {
    renderGrid()
  }, [renderGrid])

  useEffect(() => {
    renderTerrain()
  }, [renderTerrain])

  useEffect(() => {
    renderEditingState()
  }, [renderEditingState])

  useEffect(() => {
    renderUnits()
  }, [renderUnits])

  useEffect(() => {
    renderOverlay()
  }, [renderOverlay])

  useEffect(() => {
    const app = appRef.current
    if (!app || !initialized.current || app.stage.children.length === 0) return
    const hit = app.stage.getChildAt(0) as Graphics
    hit.cursor = (editingTerrain || placementMode) ? 'crosshair' : 'default'
  }, [editingTerrain, placementMode])

  const closePolygon = useCallback(() => {
    if (tempVertices.length < 3) return
    onFinishEdit(tempVertices)
    setTempVertices([])
  }, [tempVertices, onFinishEdit])

  const undoLastVertex = useCallback(() => {
    setTempVertices((prev) => prev.slice(0, -1))
  }, [])

  const handleCancelEdit = useCallback(() => {
    setTempVertices([])
    onCancelEdit()
  }, [onCancelEdit])

  const selectedTerrain = selectedTerrainId && currentGame?.terrain.find((t) => t.id === selectedTerrainId)
  const selectedUnit = selectedUnitId && currentGame?.units.find((u) => u.id === selectedUnitId)
  const terrainTypes: TerrainType[] = ['island', 'shoal', 'reef']

  return (
    <div className="flex flex-col flex-1 relative">
      <div ref={containerRef} className="flex-1" />
      {editingTerrain && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 bg-gray-900/90 border border-gray-700 rounded-lg px-4 py-2.5 backdrop-blur-sm">
          <span className="text-xs text-gray-400 self-center mr-2">
            {tempVertices.length} vertex{tempVertices.length !== 1 ? 'es' : ''}
          </span>
          <button
            onClick={undoLastVertex}
            disabled={tempVertices.length === 0}
            className="text-xs text-gray-300 hover:text-gray-100 disabled:opacity-40 px-2 py-1 border border-gray-700 rounded transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            Undo
          </button>
          <button
            onClick={closePolygon}
            disabled={tempVertices.length < 3}
            className="text-xs text-green-400 hover:text-green-300 disabled:opacity-40 px-3 py-1 border border-green-800 rounded transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            Close Polygon
          </button>
          <button
            onClick={handleCancelEdit}
            className="text-xs text-red-400 hover:text-red-300 px-2 py-1 border border-red-800 rounded transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}
      {moveTerrainId && !editingTerrain && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900/90 border border-gray-700 rounded-lg px-4 py-2.5 backdrop-blur-sm flex gap-2 items-center">
          <span className="text-xs text-gray-400">Drag the terrain to move it</span>
          <button
            onClick={() => {
              setMoveTerrainId(null)
              setMoveVertices([])
              setSelectedTerrainId(null)
              setMenuPos(null)
            }}
            className="text-xs text-red-400 hover:text-red-300 border border-red-800 rounded px-2 py-1 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}
      {editTerrainId && !editingTerrain && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900/90 border border-gray-700 rounded-lg px-4 py-2.5 backdrop-blur-sm flex gap-2 items-center">
          <span className="text-xs text-gray-400">Drag vertices to edit the polygon</span>
          <button
            onClick={() => {
              updateTerrain(editTerrainId, { vertices: editVertices })
              setEditTerrainId(null)
              setEditVertices([])
              setSelectedTerrainId(null)
              setMenuPos(null)
            }}
            className="text-xs text-green-400 hover:text-green-300 border border-green-800 rounded px-2 py-1 transition-colors cursor-pointer"
          >
            Done
          </button>
          <button
            onClick={() => {
              setEditTerrainId(null)
              setEditVertices([])
              setSelectedTerrainId(null)
              setMenuPos(null)
            }}
            className="text-xs text-red-400 hover:text-red-300 border border-red-800 rounded px-2 py-1 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}
      {selectedTerrain && menuPos && (
        <div
          className="fixed z-50 bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-xl w-44"
          style={{ left: menuPos.x, top: menuPos.y, transform: 'translate(-50%, -100%) translateY(-8px)' }}
        >
          <div className="text-xs text-gray-400 mb-2 uppercase tracking-wider font-semibold">{TERRAIN_COLORS[selectedTerrain.type].label}</div>
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
                setMoveTerrainId(selectedTerrain.id)
                setMoveVertices([...selectedTerrain.vertices])
                setMenuPos(null)
              }}
              className="flex-1 text-xs text-blue-400 hover:text-blue-300 border border-blue-800 rounded px-2 py-1.5 transition-colors cursor-pointer"
            >
              Move
            </button>
            <button
              onClick={() => {
                setEditTerrainId(selectedTerrain.id)
                setEditVertices([...selectedTerrain.vertices])
                setMenuPos(null)
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
        <div
          className="absolute z-50 bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-xl w-52 left-2 top-2"
        >
          <div className="text-xs text-gray-400 mb-1 uppercase tracking-wider font-semibold">{selectedUnit.name}</div>
          <div className="flex gap-1.5 mb-2">
            <span className={`text-xs px-1.5 py-0.5 rounded ${selectedUnit.side === 'player' ? 'bg-blue-600/30 text-blue-300' : 'bg-red-600/30 text-red-300'}`}>
              {selectedUnit.side === 'player' ? 'Player' : 'AI'}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 capitalize">{selectedUnit.status}</span>
          </div>
          <div className="text-xs text-gray-500 mb-3">
            Orientation: {COMPASS_LABELS[selectedUnit.orientation]} &middot; Attitude: {currentGame ? ATTITUDE_LABELS[computeAttitude(currentGame.windDirection, selectedUnit.orientation)] : ''}
          </div>
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
          {placementCursorPos.tableX}, {placementCursorPos.tableY} mm
        </div>
      )}
    </div>
  )
}
