import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'
import type { SavedGame, Game } from '../types'

interface GameStore {
  savedGames: SavedGame[]
  currentGame: Game | null
  hasUnsavedChanges: boolean

  createGame: (name: string) => string
  loadGame: (id: string) => void
  deleteGame: (id: string) => void
  saveCurrentGame: () => void
  exitToMenu: () => void
  markChanged: () => void
}

const now = () => new Date().toISOString()

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      savedGames: [],
      currentGame: null,
      hasUnsavedChanges: false,

      createGame: (name) => {
        const id = uuid()
        const timestamp = now()
        const game: Game = {
          id,
          name,
          createdAt: timestamp,
          updatedAt: timestamp,
          settings: {
            tableWidth: 1200,
            tableHeight: 900,
            windDirection: 0,
          },
          units: [],
          currentTurn: 1,
        }
        set((state) => ({
          savedGames: [
            ...state.savedGames,
            { id, name, createdAt: timestamp, updatedAt: timestamp, unitCount: 0 },
          ],
          currentGame: game,
          hasUnsavedChanges: true,
        }))
        return id
      },

      loadGame: (id) => {
        const stored = localStorage.getItem(`game-${id}`)
        if (stored) {
          const game = JSON.parse(stored) as Game
          set({ currentGame: game, hasUnsavedChanges: false })
        }
      },

      deleteGame: (id) => {
        localStorage.removeItem(`game-${id}`)
        set((state) => ({
          savedGames: state.savedGames.filter((g) => g.id !== id),
          currentGame: state.currentGame?.id === id ? null : state.currentGame,
        }))
      },

      saveCurrentGame: () => {
        const { currentGame, savedGames } = get()
        if (!currentGame) return
        const timestamp = now()
        const updated = { ...currentGame, updatedAt: timestamp }
        localStorage.setItem(`game-${updated.id}`, JSON.stringify(updated))
        set({
          currentGame: updated,
          hasUnsavedChanges: false,
          savedGames: savedGames.map((g) =>
            g.id === updated.id
              ? { ...g, updatedAt: timestamp, unitCount: updated.units.length }
              : g
          ),
        })
      },

      exitToMenu: () => {
        set({ currentGame: null, hasUnsavedChanges: false })
      },

      markChanged: () => {
        set({ hasUnsavedChanges: true })
      },
    }),
    {
      name: 'wargame-ai-store',
      partialize: (state) => ({
        savedGames: state.savedGames,
      }),
    }
  )
)
