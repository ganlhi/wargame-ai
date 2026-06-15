import { useState, useCallback } from 'react'
import { useGameStore } from '../stores/gameStore'
import { TableSetup } from './TableSetup'
import { PhotoCapture } from './PhotoCapture'
import { GameCanvas } from './GameCanvas'
import { UnitFormModal } from './UnitFormModal'
import { COMPASS_LABELS } from '../utils/attitude'
import type { Unit } from '../types'

export function GameView() {
  const { currentGame, hasUnsavedChanges, saveCurrentGame, exitToMenu, setPhase, addTerrain, addUnit, updateUnit, startGame, revealOrders, resolveTurn } = useGameStore()
  const [showExitDialog, setShowExitDialog] = useState(false)
  const [showPhotoCapture, setShowPhotoCapture] = useState(false)
  const [editingTerrain, setEditingTerrain] = useState(false)
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null)
  const [placementActive, setPlacementActive] = useState(false)
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null)
  const [showActionLog, setShowActionLog] = useState(false)
  const [expandedAIUnit, setExpandedAIUnit] = useState<string | null>(null)
  const hasContent = (currentGame?.terrain?.length ?? 0) > 0 || (currentGame?.units?.length ?? 0) > 0 || !!currentGame?.backgroundImage
  const [setupComplete, setSetupComplete] = useState(hasContent)

  const handleBack = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowExitDialog(true)
    } else {
      exitToMenu()
    }
  }, [hasUnsavedChanges, exitToMenu])

  const handleSaveAndExit = () => {
    saveCurrentGame()
    exitToMenu()
  }

  const handleExitWithoutSaving = () => {
    exitToMenu()
  }

  const handleSetupComplete = () => {
    setSetupComplete(true)
    if (currentGame) {
      setPhase('setup')
    }
  }

  const handleFinishTerrain = (vertices: { x: number; y: number }[]) => {
    if (vertices.length < 3) return
    addTerrain(vertices, 'island')
    setEditingTerrain(false)
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
  }

  const editingUnit = editingUnitId ? currentGame?.units.find((u) => u.id === editingUnitId) : undefined
  const showUnitForm = editingUnitId !== null

  if (!currentGame) return null

  const exitDialog = showExitDialog && (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 mx-4 max-w-sm w-full">
        <h3 className="text-lg font-semibold mb-2">Unsaved Changes</h3>
        <p className="text-sm text-gray-400 mb-6">You have unsaved changes. What would you like to do?</p>
        <div className="flex flex-col gap-2">
          <button onClick={handleSaveAndExit} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer">
            Save &amp; Exit
          </button>
          <button onClick={handleExitWithoutSaving} className="text-red-400 hover:text-red-300 px-4 py-2 rounded-lg text-sm border border-red-800 transition-colors cursor-pointer">
            Exit Without Saving
          </button>
          <button onClick={() => setShowExitDialog(false)} className="text-gray-400 hover:text-gray-200 px-4 py-2 rounded-lg text-sm transition-colors cursor-pointer">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )

  if (!setupComplete) {
    return (
      <div className="min-h-svh flex flex-col bg-gray-950 text-gray-100">
        <header className="border-b border-gray-800 px-4 py-3 flex items-center gap-4">
          <button
            onClick={handleBack}
            className="text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
            title="Back to menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="text-base font-semibold">{currentGame.name}</h1>
            <p className="text-xs text-gray-500">Setup</p>
          </div>
          {hasUnsavedChanges && (
            <span className="text-xs text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded">Unsaved</span>
          )}
          <button onClick={saveCurrentGame} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer">
            Save
          </button>
        </header>
        <TableSetup onComplete={handleSetupComplete} />
        {exitDialog}
      </div>
    )
  }

  return (
    <div className="min-h-svh flex flex-col bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-4 py-3 flex items-center gap-4">
        <button
          onClick={handleBack}
          className="text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
          title="Back to menu"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-base font-semibold">{currentGame.name}</h1>
          <p className="text-xs text-gray-500">
            {currentGame.currentPhase !== 'setup' ? `Turn ${currentGame.currentTurn} · ` : ''}{currentGame.tableWidth}&times;{currentGame.tableHeight}mm · Wind: {COMPASS_LABELS[currentGame.windDirection]} · <span className="capitalize">{currentGame.currentPhase === 'game_over' ? 'Game Over' : currentGame.currentPhase}</span>
          </p>
        </div>
        {hasUnsavedChanges && (
          <span className="text-xs text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded">Unsaved</span>
        )}
        {currentGame.currentPhase === 'setup' && !editingTerrain && editingUnitId === null && !placementActive && (
          <button
            onClick={() => setEditingTerrain(true)}
            className="text-gray-400 hover:text-gray-200 px-2 py-1 text-sm transition-colors cursor-pointer"
            title="Add terrain"
          >
            + Terrain
          </button>
        )}
        {currentGame.currentPhase === 'setup' && !placementActive && editingUnitId === null && (
          <button
            onClick={() => setPlacementActive(true)}
            className="text-gray-400 hover:text-gray-200 px-2 py-1 text-sm transition-colors cursor-pointer"
            title="Add unit"
          >
            + Unit
          </button>
        )}
        {currentGame.currentPhase === 'setup' && (
          <button
            onClick={() => setShowPhotoCapture(true)}
            className="text-gray-400 hover:text-gray-200 px-2 py-1 text-sm transition-colors cursor-pointer"
            title="Capture table photo"
          >
            📷
          </button>
        )}
        {currentGame.currentPhase === 'setup' && (
          <button
            onClick={startGame}
            className="bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Start Game
          </button>
        )}
        {currentGame.currentPhase === 'orders' && (
          <button
            onClick={revealOrders}
            className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Reveal AI Orders
          </button>
        )}
        {currentGame.currentPhase === 'reveal' && (
          <button
            onClick={resolveTurn}
            className="bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Resolve Turn
          </button>
        )}
        {currentGame.currentPhase !== 'setup' && (
          <button
            onClick={() => setShowActionLog(!showActionLog)}
            className={`px-2 py-1 text-sm rounded transition-colors cursor-pointer ${showActionLog ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
            title="Action Log"
          >
            Log
          </button>
        )}
        <button onClick={saveCurrentGame} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer">
          Save
        </button>
      </header>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <GameCanvas
          editingTerrain={editingTerrain}
          onFinishEdit={handleFinishTerrain}
          onCancelEdit={() => setEditingTerrain(false)}
          onEditUnit={(id) => setEditingUnitId(id)}
          placementMode={placementActive}
          onTableClick={handleTableClick}
        />
        {placementActive && (
          <div className="absolute inset-x-0 top-0 flex items-center justify-center pointer-events-none">
            <div className="bg-gray-900/90 border border-gray-700 rounded-b-lg px-4 py-2 flex items-center gap-3 pointer-events-auto backdrop-blur-sm">
              <span className="text-xs text-gray-300">Click on the battlefield to place the unit</span>
              <button
                onClick={() => setPlacementActive(false)}
                className="text-xs text-red-400 hover:text-red-300 border border-red-800 rounded px-2 py-1 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {currentGame.currentPhase === 'reveal' && currentGame.units.filter(u => u.side === 'ai' && u.status === 'active').length > 0 && (
          <div className="absolute right-2 top-2 bottom-2 w-64 flex flex-col gap-2 pointer-events-none">
            {currentGame.units.filter(u => u.side === 'ai' && u.status === 'active').map(aiUnit => (
              <div
                key={aiUnit.id}
                className="bg-gray-900/90 border border-gray-700 rounded-lg p-3 pointer-events-auto backdrop-blur-sm cursor-pointer"
                onClick={() => setExpandedAIUnit(expandedAIUnit === aiUnit.id ? null : aiUnit.id)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{aiUnit.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${aiUnit.aiStyle === 'aggressive' ? 'bg-red-900/50 text-red-300' : aiUnit.aiStyle === 'cautious' ? 'bg-yellow-900/50 text-yellow-300' : 'bg-blue-900/50 text-blue-300'}`}>
                    {aiUnit.aiStyle}
                  </span>
                </div>
                {expandedAIUnit === aiUnit.id && aiUnit.hiddenAIOrder && (
                  <div className="mt-2 text-xs text-gray-400 space-y-1">
                    <p>Total turn pts: {aiUnit.hiddenAIOrder.totalTurnPoints}</p>
                    <p>Effective max: {Math.round(aiUnit.hiddenAIOrder.effectiveMaxSpeed)}mm</p>
                    <p className="text-gray-500">Chunks: {aiUnit.hiddenAIOrder.chunks.map((c, i) => (
                      <span key={i}>
                        {i > 0 && ' → '}
                        {Math.round(c.distance)}mm{c.turn ? ` ${c.turn.direction === 'port' ? '←' : '→'}${c.turn.points}` : ''}
                      </span>
                    ))}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {showActionLog && currentGame.currentPhase !== 'setup' && (
          <div className="absolute right-2 top-2 bottom-2 w-72 bg-gray-900/95 border border-gray-700 rounded-lg pointer-events-auto backdrop-blur-sm flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
              <span className="text-sm font-medium text-white">Action Log</span>
              <button
                onClick={() => setShowActionLog(false)}
                className="text-gray-400 hover:text-gray-200 text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {currentGame.actionLog.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-4">No actions yet</p>
              )}
              {[...currentGame.actionLog].reverse().map((entry, i) => (
                <div key={i} className="text-xs border-l-2 border-gray-700 pl-2 py-1">
                  {entry.turn > 0 && <span className="text-gray-600">T{entry.turn} </span>}
                  <span className="text-gray-400">{entry.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentGame.currentPhase === 'game_over' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 text-center pointer-events-auto">
              <h2 className="text-2xl font-bold text-white mb-2">Game Over</h2>
              <p className="text-gray-400">All units on one side have been defeated</p>
            </div>
          </div>
        )}
      </main>

      {showUnitForm && (
        <UnitFormModal
          unit={editingUnit}
          defaultPosition={pendingPosition ?? undefined}
          onSave={handleSaveUnit}
          onClose={() => { setEditingUnitId(null); setPendingPosition(null) }}
        />
      )}

      {showPhotoCapture && <PhotoCapture onClose={() => setShowPhotoCapture(false)} />}

      {exitDialog}
    </div>
  )
}
