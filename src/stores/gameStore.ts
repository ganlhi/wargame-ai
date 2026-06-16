import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'
import type { SavedGame, GameState, TableTerrain, Unit, GamePhase, ActionLogEntry, MovementPlan } from '../types'
import { applyMovementPlan } from '../game/movement'
import { suggestMovement } from '../game/ai'
import { computeAIFirePlan } from '../game/combat'
import { computeAttitude } from '../utils/attitude'

interface GameStore {
  savedGames: SavedGame[]
  currentGame: GameState | null
  hasUnsavedChanges: boolean
  defaultTableWidth: number
  defaultTableHeight: number

  createGame: (name: string) => string
  loadGame: (id: string) => void
  deleteGame: (id: string) => void
  saveCurrentGame: () => void
  exitToMenu: () => void
  markChanged: () => void

  setTableDimensions: (width: number, height: number) => void
  setWindDirection: (direction: number) => void
  setPhase: (phase: GamePhase) => void
  nextTurn: () => void
  setBackgroundImage: (dataUrl: string) => void

  addTerrain: (vertices: { x: number; y: number }[], type: TableTerrain['type']) => void
  updateTerrain: (id: string, updates: Partial<TableTerrain>) => void
  removeTerrain: (id: string) => void

  addUnit: (unit: Unit) => void
  updateUnit: (id: string, updates: Partial<Unit>) => void
  removeUnit: (id: string) => void
  addLogEntry: (entry: ActionLogEntry) => void
  startGame: () => void
  revealOrders: () => void
  resolveTurn: () => void
  setPlayerOrder: (id: string, plan: MovementPlan | null) => void
}

const now = () => new Date().toISOString()

function createInitialGame(name: string, defaultWidth: number, defaultHeight: number): GameState {
  const id = uuid()
  const timestamp = now()
  return {
    id,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    tableWidth: defaultWidth,
    tableHeight: defaultHeight,
    windDirection: 0,
    terrain: [],
    units: [],
    currentTurn: 1,
    currentPhase: 'setup',
    actionLog: [],
  }
}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      savedGames: [],
      currentGame: null,
      hasUnsavedChanges: false,
      defaultTableWidth: 1200,
      defaultTableHeight: 900,

      createGame: (name) => {
        const { defaultTableWidth, defaultTableHeight } = get()
        const game = createInitialGame(name, defaultTableWidth, defaultTableHeight)
        set((state) => ({
          savedGames: [
            ...state.savedGames,
            { id: game.id, name, createdAt: game.createdAt, updatedAt: game.updatedAt, unitCount: 0 },
          ],
          currentGame: game,
          hasUnsavedChanges: true,
        }))
        return game.id
      },

      loadGame: (id) => {
        const stored = localStorage.getItem(`game-${id}`)
        if (stored) {
          const raw = JSON.parse(stored)
          const game: GameState = {
            id: raw.id,
            name: raw.name,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            tableWidth: raw.tableWidth ?? raw.settings?.tableWidth ?? 1200,
            tableHeight: raw.tableHeight ?? raw.settings?.tableHeight ?? 900,
            windDirection: raw.windDirection ?? raw.settings?.windDirection ?? 0,
            terrain: raw.terrain ?? [],
            units: (raw.units ?? []).map((u: Record<string, unknown>) => ({
              ...u,
              prevAttitude: u.prevAttitude ?? 'reaching',
              prevMoveDistance: u.prevMoveDistance ?? 0,
              hiddenAIOrder: u.hiddenAIOrder ?? null,
              playerOrder: u.playerOrder ?? null,
              driftSpeed: u.driftSpeed ?? 10,
              lastFireChunk: u.lastFireChunk ?? null,
              hiddenAIFirePlan: u.hiddenAIFirePlan ?? null,
              firingArcs: ((u.firingArcs ?? []) as Record<string, unknown>[]).map((a) => ({
                id: String(a.id ?? ''),
                side: (a.side as 'bow' | 'stern' | 'port' | 'starboard') ?? 'starboard',
                maxRange: Number(a.maxRange ?? 300),
                weapons: Number(a.weapons ?? 10),
              })),
            })),
            currentTurn: raw.currentTurn ?? 1,
            currentPhase: raw.currentPhase ?? 'setup',
            actionLog: raw.actionLog ?? [],
            backgroundImage: raw.backgroundImage,
          }
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
        const { currentGame, savedGames } = get()
        if (currentGame) {
          const stored = localStorage.getItem(`game-${currentGame.id}`)
          if (!stored) {
            set({
              savedGames: savedGames.filter((g) => g.id !== currentGame.id),
            })
          }
        }
        set({ currentGame: null, hasUnsavedChanges: false })
      },

      markChanged: () => {
        set({ hasUnsavedChanges: true })
      },

      setTableDimensions: (width, height) => {
        const game = get().currentGame
        if (!game) return
        set({
          currentGame: { ...game, tableWidth: width, tableHeight: height, updatedAt: now() },
          defaultTableWidth: width,
          defaultTableHeight: height,
          hasUnsavedChanges: true,
        })
      },

      setWindDirection: (direction) => {
        const game = get().currentGame
        if (!game) return
        set({
          currentGame: { ...game, windDirection: direction, updatedAt: now() },
          hasUnsavedChanges: true,
        })
      },

      setPhase: (phase) => {
        const game = get().currentGame
        if (!game) return
        set({
          currentGame: { ...game, currentPhase: phase, updatedAt: now() },
          hasUnsavedChanges: true,
        })
      },

      nextTurn: () => {
        const game = get().currentGame
        if (!game) return
        set({
          currentGame: {
            ...game,
            currentTurn: game.currentTurn + 1,
            currentPhase: 'orders',
            updatedAt: now(),
          },
          hasUnsavedChanges: true,
        })
      },

      setBackgroundImage: (dataUrl) => {
        const game = get().currentGame
        if (!game) return
        set({
          currentGame: { ...game, backgroundImage: dataUrl, updatedAt: now() },
          hasUnsavedChanges: true,
        })
      },

      addTerrain: (vertices, type) => {
        const game = get().currentGame
        if (!game) return
        const terrain: TableTerrain = { id: uuid(), vertices, type }
        set({
          currentGame: {
            ...game,
            terrain: [...game.terrain, terrain],
            updatedAt: now(),
          },
          hasUnsavedChanges: true,
        })
      },

      updateTerrain: (id, updates) => {
        const game = get().currentGame
        if (!game) return
        set({
          currentGame: {
            ...game,
            terrain: game.terrain.map((t) => (t.id === id ? { ...t, ...updates } : t)),
            updatedAt: now(),
          },
          hasUnsavedChanges: true,
        })
      },

      removeTerrain: (id) => {
        const game = get().currentGame
        if (!game) return
        set({
          currentGame: {
            ...game,
            terrain: game.terrain.filter((t) => t.id !== id),
            updatedAt: now(),
          },
          hasUnsavedChanges: true,
        })
      },

      addUnit: (unit) => {
        const game = get().currentGame
        if (!game) return
        set({
          currentGame: {
            ...game,
            units: [...game.units, unit],
            updatedAt: now(),
          },
          hasUnsavedChanges: true,
        })
      },

      updateUnit: (id, updates) => {
        const game = get().currentGame
        if (!game) return
        set({
          currentGame: {
            ...game,
            units: game.units.map((u) => (u.id === id ? { ...u, ...updates } : u)),
            updatedAt: now(),
          },
          hasUnsavedChanges: true,
        })
      },

      removeUnit: (id) => {
        const game = get().currentGame
        if (!game) return
        set({
          currentGame: {
            ...game,
            units: game.units.filter((u) => u.id !== id),
            updatedAt: now(),
          },
          hasUnsavedChanges: true,
        })
      },

      addLogEntry: (entry) => {
        const game = get().currentGame
        if (!game) return
        set({
          currentGame: {
            ...game,
            actionLog: [...game.actionLog, entry],
            updatedAt: now(),
          },
          hasUnsavedChanges: true,
        })
      },

      startGame: () => {
        const game = get().currentGame
        if (!game) return
        const units = game.units.map((u) => {
          const attitude = computeAttitude(game.windDirection, u.orientation)
          return { ...u, attitude, prevAttitude: attitude }
        })
        set({
          currentGame: {
            ...game,
            units,
            currentTurn: 1,
            currentPhase: 'orders',
            actionLog: [{ turn: 0, text: 'Game started' }],
            updatedAt: now(),
          },
          hasUnsavedChanges: true,
        })
        const updated = get().currentGame
        if (updated) {
          for (const u of updated.units) {
            if (u.side === 'ai') {
              const order = suggestMovement(
                u,
                updated.units,
                updated.terrain,
                updated.windDirection,
                updated.tableWidth,
                updated.tableHeight,
                u.prevAttitude,
                1,
              )
              get().updateUnit(u.id, { hiddenAIOrder: order })
            }
          }
        }
      },

      revealOrders: () => {
        const game = get().currentGame
        if (!game) return

        const units = game.units.map((u) => {
          if (u.side !== 'ai' || u.status === 'destroyed' || u.status === 'surrendered') return u
          const firePlan = computeAIFirePlan(u, game.units, game.windDirection)
          return { ...u, hiddenAIFirePlan: firePlan, lastFireChunk: firePlan?.chunkIndex ?? u.lastFireChunk }
        })

        set({
          currentGame: {
            ...game,
            units,
            currentPhase: 'reveal',
            updatedAt: now(),
          },
          hasUnsavedChanges: true,
        })
      },

      setPlayerOrder: (id: string, plan: MovementPlan | null) => {
        const game = get().currentGame
        if (!game) return
        set({
          currentGame: {
            ...game,
            units: game.units.map((u) => (u.id === id ? { ...u, playerOrder: plan } : u)),
            updatedAt: now(),
          },
          hasUnsavedChanges: true,
        })
      },

      resolveTurn: () => {
        const game = get().currentGame
        if (!game || game.currentPhase !== 'reveal') return

        const units = [...game.units]

        for (let i = 0; i < units.length; i++) {
          const u = units[i]
          const plan = u.side === 'ai' ? u.hiddenAIOrder : u.playerOrder
          if (!plan) continue

          const result = applyMovementPlan(u, plan, game.windDirection, game.tableWidth, game.tableHeight)
          const drift = result.isInIrons ? ` (drifted ${u.driftSpeed}mm per chunk)` : ''
          const boundary = result.hitBoundary ? ' [hit table edge]' : ''
          const totalDist = plan.chunks.reduce((s, c) => s + c.distance, 0)
          get().addLogEntry({
            turn: game.currentTurn,
            unitId: u.id,
            unitName: u.name,
            text: `${u.name} moved to (${Math.round(result.position.x)}, ${Math.round(result.position.y)}) heading ${result.orientation}pts${drift}${boundary}`,
          })
          units[i] = {
            ...u,
            position: result.position,
            orientation: result.orientation,
            attitude: result.attitude,
            prevAttitude: u.attitude,
            prevMoveDistance: totalDist,
            isInIrons: result.isInIrons,
            hiddenAIOrder: null,
            playerOrder: null,
            hiddenAIFirePlan: null,
          }
        }

        const nextTurn = game.currentTurn + 1

        set({
          currentGame: {
            ...game,
            units,
            currentTurn: nextTurn,
            currentPhase: 'orders',
            updatedAt: now(),
          },
          hasUnsavedChanges: true,
        })

        const updated = get().currentGame
        if (updated) {
          for (const u of updated.units) {
            if (u.side === 'ai') {
              const order = suggestMovement(
                u,
                updated.units,
                updated.terrain,
                updated.windDirection,
                updated.tableWidth,
                updated.tableHeight,
                u.prevAttitude,
                1,
              )
              get().updateUnit(u.id, { hiddenAIOrder: order })
            }
          }
        }
      },
    }),
    {
      name: 'wargame-ai-store',
      partialize: (state) => ({
        savedGames: state.savedGames,
        defaultTableWidth: state.defaultTableWidth,
        defaultTableHeight: state.defaultTableHeight,
      }),
    }
  )
)
