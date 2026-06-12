import { useRef, useEffect, useCallback, useState } from 'react'
import { Application, Graphics, Container, Sprite, Texture } from 'pixi.js'
import { useGameStore } from '../stores/gameStore'
import { TERRAIN_COLORS } from './TerrainPanel'
import type { TerrainType } from '../types'

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
}

export function GameCanvas({ editingTerrain, onFinishEdit, onCancelEdit }: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const initialized = useRef(false)
  const bgContainerRef = useRef<Container | null>(null)
  const gridContainerRef = useRef<Container | null>(null)
  const terrainContainerRef = useRef<Container | null>(null)
  const editContainerRef = useRef<Container | null>(null)
  const [tempVertices, setTempVertices] = useState<{ x: number; y: number }[]>([])
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const draggingVertex = useRef<number | null>(null)
  const editingTerrainRef = useRef(editingTerrain)
  const currentGame = useGameStore((s) => s.currentGame)
  const updateTerrain = useGameStore((s) => s.updateTerrain)
  const removeTerrain = useGameStore((s) => s.removeTerrain)
  const sizeRef = useRef({ w: 0, h: 0 })
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const handleDragRef = useRef<(sx: number, sy: number) => void>(() => {})
  const renderBackgroundRef = useRef<() => void>(() => {})
  const renderGridRef = useRef<() => void>(() => {})
  const renderTerrainRef = useRef<() => void>(() => {})

  useEffect(() => {
    editingTerrainRef.current = editingTerrain
  }, [editingTerrain])

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
      const sv = t.vertices.map((v) => tableToScreen(v.x, v.y, w, h))
      const c = TERRAIN_COLORS[t.type]
      const g = new Graphics()
      const isSelected = t.id === selectedTerrainId
      g.poly(sv.flatMap((v) => [v.x, v.y]))
      g.fill({ color: parseInt(c.fill.slice(1), 16), alpha: TERRAIN_FILL_ALPHA })
      g.stroke({ color: isSelected ? 0xffffff : parseInt(c.border.slice(1), 16), width: isSelected ? 3 : TERRAIN_BORDER_WIDTH, alpha: 0.9 })
      g.eventMode = 'static'
      g.cursor = 'pointer'
      const terrainId = t.id
      g.on('pointerdown', (e) => {
        if (editingTerrainRef.current) return
        e.stopPropagation()
        setSelectedTerrainId(terrainId)
        setMenuPos({ x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
      })
      tc.addChild(g)
    }
  }, [currentGame, tableToScreen, selectedTerrainId])

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
      const texture = Texture.from(currentGame.backgroundImage)
      const sprite = new Sprite(texture)
      sprite.x = ox
      sprite.y = oy
      sprite.width = currentGame.tableWidth * s
      sprite.height = currentGame.tableHeight * s
      bc.addChild(sprite)
    }

    const bg = new Graphics()
    bg.rect(PADDING, PADDING, w - PADDING * 2, h - PADDING * 2)
    bg.fill({ color: 0x1a1a2e, alpha: 0.95 })
    bc.addChild(bg)
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

  useEffect(() => { handleDragRef.current = handleDrag }, [handleDrag])
  useEffect(() => { renderBackgroundRef.current = renderBackground }, [renderBackground])
  useEffect(() => { renderGridRef.current = renderGrid }, [renderGrid])
  useEffect(() => { renderTerrainRef.current = renderTerrain }, [renderTerrain])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    if (initialized.current) {
      renderBackground()
      renderGrid()
      renderTerrain()
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
      const edit = new Container()
      app.stage.addChild(bg, grid, terrain, edit)
      bgContainerRef.current = bg
      gridContainerRef.current = grid
      terrainContainerRef.current = terrain
      editContainerRef.current = edit

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
        if (!editingTerrainRef.current) {
          setSelectedTerrainId(null)
          setMenuPos(null)
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
        }
      })
      ro.observe(el)
      resizeObserverRef.current = ro

      renderBackgroundRef.current()
      renderGridRef.current()
      renderTerrainRef.current()
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
    renderTerrain()
  }, [renderTerrain])

  useEffect(() => {
    renderEditingState()
  }, [renderEditingState])

  useEffect(() => {
    const app = appRef.current
    if (!app || !initialized.current || app.stage.children.length === 0) return
    const hit = app.stage.getChildAt(0) as Graphics
    hit.cursor = editingTerrain ? 'crosshair' : 'default'
  }, [editingTerrain])

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
          <button
            onClick={() => {
              removeTerrain(selectedTerrain.id)
              setSelectedTerrainId(null)
              setMenuPos(null)
            }}
            className="mt-3 w-full text-xs text-red-400 hover:text-red-300 border border-red-800 rounded px-2 py-1.5 transition-colors cursor-pointer"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
