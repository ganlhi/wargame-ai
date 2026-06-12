import { useState } from 'react'
import { useGameStore } from '../stores/gameStore'

export function MainMenu() {
  const { savedGames, createGame, loadGame, deleteGame } = useGameStore()
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const handleCreate = () => {
    if (!newName.trim()) return
    createGame(newName.trim())
    setNewName('')
    setShowNew(false)
  }

  const handleDelete = (id: string) => {
    deleteGame(id)
    setDeleteConfirm(null)
  }

  return (
    <div className="min-h-svh flex flex-col bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4">
        <h1 className="text-2xl font-bold tracking-tight">Wargame AI</h1>
        <p className="text-sm text-gray-400 mt-1">Tabletop wargame companion</p>
      </header>

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Saved Games</h2>
          <button
            onClick={() => setShowNew(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            + New Game
          </button>
        </div>

        {showNew && (
          <div className="mb-6 p-4 border border-gray-700 rounded-xl bg-gray-900">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Game Name
            </label>
            <div className="flex gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="e.g. Battle of Trafalgar"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setShowNew(false)
                  setNewName('')
                }}
                className="text-gray-400 hover:text-gray-200 px-3 py-2 text-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {savedGames.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-gray-800 rounded-xl">
            <div className="text-5xl mb-4 text-gray-600">🗺️</div>
            <p className="text-gray-400 mb-2">No saved games yet</p>
            <p className="text-sm text-gray-600">
              Create a new game to get started
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {savedGames.map((game) => (
              <li
                key={game.id}
                className="flex items-center justify-between p-4 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors"
              >
                <button
                  onClick={() => loadGame(game.id)}
                  className="text-left flex-1 cursor-pointer"
                >
                  <span className="font-medium text-gray-100">{game.name}</span>
                  <div className="text-xs text-gray-500 mt-1">
                    {game.unitCount} unit{game.unitCount !== 1 ? 's' : ''} &middot; Last played{' '}
                    {new Date(game.updatedAt).toLocaleDateString()}
                  </div>
                </button>
                {deleteConfirm === game.id ? (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleDelete(game.id)}
                      className="text-red-400 hover:text-red-300 text-xs font-medium px-3 py-1.5 border border-red-800 rounded-lg transition-colors cursor-pointer"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="text-gray-500 hover:text-gray-300 text-xs px-3 py-1.5 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(game.id)}
                    className="text-gray-600 hover:text-red-400 transition-colors px-2 py-1 cursor-pointer"
                    title="Delete game"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
