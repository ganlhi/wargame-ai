import { useState, useCallback } from 'react'
import { useGameStore } from '../stores/gameStore'
import { TableSetup } from './TableSetup'
import { PhotoCapture } from './PhotoCapture'
import { GameCanvas } from './GameCanvas'

export function GameView() {
  const { currentGame, hasUnsavedChanges, saveCurrentGame, exitToMenu, setPhase, addTerrain } = useGameStore()
  const [showExitDialog, setShowExitDialog] = useState(false)
  const [showPhotoCapture, setShowPhotoCapture] = useState(false)
  const [editingTerrain, setEditingTerrain] = useState(false)
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
            Turn {currentGame.currentTurn} &middot; {currentGame.tableWidth}&times;{currentGame.tableHeight}mm &middot; Wind: point {currentGame.windDirection}
          </p>
        </div>
        {hasUnsavedChanges && (
          <span className="text-xs text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded">Unsaved</span>
        )}
        {!editingTerrain && (
          <button
            onClick={() => setEditingTerrain(true)}
            className="text-gray-400 hover:text-gray-200 px-2 py-1 text-sm transition-colors cursor-pointer"
            title="Add terrain"
          >
            + Terrain
          </button>
        )}
        <button
          onClick={() => setShowPhotoCapture(true)}
          className="text-gray-400 hover:text-gray-200 px-2 py-1 text-sm transition-colors cursor-pointer"
          title="Capture table photo"
        >
          📷
        </button>
        <button onClick={saveCurrentGame} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer">
          Save
        </button>
      </header>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <GameCanvas
          editingTerrain={editingTerrain}
          onFinishEdit={handleFinishTerrain}
          onCancelEdit={() => setEditingTerrain(false)}
        />
      </main>

      {showPhotoCapture && <PhotoCapture onClose={() => setShowPhotoCapture(false)} />}

      {exitDialog}
    </div>
  )
}
