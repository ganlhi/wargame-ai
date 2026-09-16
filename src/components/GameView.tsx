import { useState, useCallback } from 'react'
import { useGameStore } from '../stores/gameStore'
import { GameCanvas } from './GameCanvas'
import { UnitFormModal } from './UnitFormModal'
import { TerrainFormModal } from './TerrainFormModal'
import { TablePanel } from './TablePanel'
import { AIOrdersPanel } from './AIOrdersPanel'
import { WindControl } from './WindControl'
import { originName } from '../utils/coordinates'
import type { Unit } from '../types'
import { saveGame } from '../sync/syncActions'
import { DriveStatusBadge } from './DriveStatusBadge'

/**
 * The battlefield. There is no setup screen: a game is a table that gets
 * re-described every turn, so everything is editable at all times, and the
 * one button that changes with the phase either reveals the AI's orders for
 * the table as described or, once they have been carried out, starts the
 * next turn.
 */
export function GameView() {
  const { currentGame, hasUnsavedChanges, exitToMenu, addUnit, updateUnit, revealOrders, nextTurn } = useGameStore()
  const [showExitDialog, setShowExitDialog] = useState(false)
  const [editingTerrainId, setEditingTerrainId] = useState<string | null>(null)
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null)
  const [placementActive, setPlacementActive] = useState(false)
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null)
  const [showBases, setShowBases] = useState(true)

  const handleBack = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowExitDialog(true)
    } else {
      exitToMenu()
    }
  }, [hasUnsavedChanges, exitToMenu])

  const handleSaveAndExit = () => {
    saveGame()
    exitToMenu()
  }

  const handleTableClick = (x: number, y: number) => {
    setPendingPosition({ x, y })
    setPlacementActive(false)
    setEditingUnitId('new')
  }

  const handleSaveUnit = (unit: Unit) => {
    const existing = currentGame?.units.find((u) => u.id === unit.id)
    if (existing) {
      updateUnit(unit.id, unit)
    } else {
      addUnit(unit)
    }
    setEditingUnitId(null)
    setPendingPosition(null)
  }

  const editingUnit = editingUnitId ? currentGame?.units.find((u) => u.id === editingUnitId) : undefined
  const editingTerrain = editingTerrainId ? currentGame?.terrain.find((t) => t.id === editingTerrainId) : undefined

  if (!currentGame) return null

  const hasAIShips = currentGame.units.some(
    (u) => u.side === 'ai' && u.status !== 'destroyed' && u.status !== 'surrendered',
  )
  const anchor = originName(currentGame)

  return (
    <div className="min-h-svh flex flex-col bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-4 py-3 flex items-center gap-3 flex-wrap">
        <button
          onClick={handleBack}
          className="text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
          title="Back to menu"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">{currentGame.name}</h1>
          <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
            <WindControl />
            <span>
              {currentGame.scale} · Origin: {anchor ?? 'none yet'} ·{' '}
              {currentGame.phase === 'orders' ? 'Orders revealed' : 'Describing the table'}
            </span>
          </div>
        </div>
        <DriveStatusBadge />
        {hasUnsavedChanges && (
          <span className="text-xs text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded">Unsaved</span>
        )}
        {currentGame.phase === 'input' ? (
          <button
            onClick={revealOrders}
            disabled={!hasAIShips}
            title={hasAIShips ? 'Lay the AI’s orders for the table as described' : 'Add an AI ship first'}
            className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reveal orders
          </button>
        ) : (
          <button
            onClick={nextTurn}
            title="The orders have been carried out on the table; clear them and describe the next turn"
            className="bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Next turn
          </button>
        )}
        <button
          onClick={() => setShowBases(!showBases)}
          className={`px-2 py-1 text-sm rounded transition-colors cursor-pointer ${showBases ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          title="Toggle ship base outlines"
          aria-pressed={showBases}
        >
          Bases
        </button>
        <button onClick={saveGame} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer">
          Save
        </button>
      </header>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <GameCanvas
          onEditUnit={(id) => setEditingUnitId(id)}
          onEditTerrain={(id) => setEditingTerrainId(id)}
          placementMode={placementActive}
          onTableClick={handleTableClick}
          showBases={showBases}
        />
        {placementActive && (
          <div className="absolute inset-x-0 top-0 flex items-center justify-center pointer-events-none">
            <div className="bg-gray-900/90 border border-gray-700 rounded-b-lg px-4 py-2 flex items-center gap-3 pointer-events-auto backdrop-blur-sm">
              <span className="text-xs text-gray-300">Tap the water where the centre of the ship's base lies</span>
              <button
                onClick={() => setPlacementActive(false)}
                className="text-xs text-red-400 hover:text-red-300 border border-red-800 rounded px-2 py-1 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        <AIOrdersPanel />
      </main>

      <TablePanel
        onAddShip={() => setEditingUnitId('new')}
        onPlaceShip={() => setPlacementActive(true)}
        onAddTerrain={() => setEditingTerrainId('new')}
        onEditUnit={(id) => setEditingUnitId(id)}
        onEditTerrain={(id) => setEditingTerrainId(id)}
      />

      {editingUnitId !== null && (
        <UnitFormModal
          unit={editingUnit}
          defaultPosition={pendingPosition ?? undefined}
          onSave={handleSaveUnit}
          onClose={() => { setEditingUnitId(null); setPendingPosition(null) }}
        />
      )}

      {editingTerrainId !== null && (
        <TerrainFormModal terrain={editingTerrain} onClose={() => setEditingTerrainId(null)} />
      )}

      {showExitDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 mx-4 max-w-sm w-full">
            <h3 className="text-lg font-semibold mb-2">Unsaved Changes</h3>
            <p className="text-sm text-gray-400 mb-6">You have unsaved changes. What would you like to do?</p>
            <div className="flex flex-col gap-2">
              <button onClick={handleSaveAndExit} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer">
                Save &amp; Exit
              </button>
              <button onClick={exitToMenu} className="text-red-400 hover:text-red-300 px-4 py-2 rounded-lg text-sm border border-red-800 transition-colors cursor-pointer">
                Exit Without Saving
              </button>
              <button onClick={() => setShowExitDialog(false)} className="text-gray-400 hover:text-gray-200 px-4 py-2 rounded-lg text-sm transition-colors cursor-pointer">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
