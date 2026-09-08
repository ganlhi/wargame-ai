import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'
import type { SavedGame, GameState, TableTerrain, Unit, GamePhase, ActionLogEntry, MovementPlan } from '../types'
import { applyMovementPlan } from '../game/movement'
import { suggestMovement, decideAggressiveAction } from '../game/ai'
import { computeAIFirePlan } from '../game/combat'
import { applyGrapple, clearGrappleForRemoved } from '../game/grapple'
import { computeAttitude } from '../utils/attitude'
import { formatWorldPoint, sternMidpoint } from '../utils/coordinates'
import { migrateSavedGame, CURRENT_SCHEMA_VERSION } from './migrations'

interface GameStore {
  savedGames: SavedGame[]
  currentGame: GameState | null
  hasUnsavedChanges: boolean

  createGame: (name: string) => string
  loadGame: (id: string) => void
  deleteGame: (id: string) => void
  saveCurrentGame: () => void
  exitToMenu: () => void
  markChanged: () => void

  setWindDirection: (direction: number) => void
  setPhase: (phase: GamePhase) => void
  nextTurn: () => void
  setOrigin: (id: string) => void

  addTerrain: (terrain: Omit<TableTerrain, 'id'>) => void
  updateTerrain: (id: string, updates: Partial<TableTerrain>) => void
  removeTerrain: (id: string) => void

  addUnit: (unit: Unit) => void
  updateUnit: (id: string, updates: Partial<Unit>) => void
  removeUnit: (id: string) => void
  setGrapple: (id: string, otherId: string | null) => void
  addLogEntry: (entry: ActionLogEntry) => void
  startGame: () => void
  revealOrders: () => void
  resolveTurn: () => void
  setPlayerOrder: (id: string, plan: MovementPlan | null) => void
}

const now = () => new Date().toISOString()

/**
 * Pick the origin after an entity is deleted. A destroyed or surrendered ship
 * is still a model sitting on the table, so it stays a valid reference point —
 * only actually removing it from the game gives up the anchor, at which point
 * the next remaining entity takes over. World coordinates are untouched; only
 * the frame the readouts use shifts.
 */
function reassignOrigin(
  game: GameState,
  removedId: string,
  units: Unit[],
  terrain: TableTerrain[],
): string | null {
  if (game.originId !== removedId) return game.originId
  return units[0]?.id ?? terrain[0]?.id ?? null
}

function createInitialGame(name: string): GameState {
  const id = uuid()
  const timestamp = now()
  return {
    id,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    originId: null,
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

      createGame: (name) => {
        const game = createInitialGame(name)
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
          const game = migrateSavedGame(JSON.parse(stored))
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

      /**
       * Re-anchor the coordinate system onto another entity. Nothing on the
       * table moves — only the frame positions are reported in.
       */
      setOrigin: (id) => {
        const game = get().currentGame
        if (!game) return
        const exists =
          game.units.some((u) => u.id === id) || game.terrain.some((t) => t.id === id)
        if (!exists) return
        set({
          currentGame: { ...game, originId: id, updatedAt: now() },
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

      addTerrain: (spec) => {
        const game = get().currentGame
        if (!game) return
        const terrain: TableTerrain = { ...spec, id: uuid() }
        set({
          currentGame: {
            ...game,
            terrain: [...game.terrain, terrain],
            // First entity placed defines the origin for everything else.
            originId: game.originId ?? terrain.id,
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
        const terrain = game.terrain.filter((t) => t.id !== id)
        set({
          currentGame: {
            ...game,
            terrain,
            originId: reassignOrigin(game, id, game.units, terrain),
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
            // First entity placed defines the origin for everything else.
            originId: game.originId ?? unit.id,
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
        const units = clearGrappleForRemoved(game.units, id)
        set({
          currentGame: {
            ...game,
            units,
            originId: reassignOrigin(game, id, units, game.terrain),
            updatedAt: now(),
          },
          hasUnsavedChanges: true,
        })
      },

      setGrapple: (id, otherId) => {
        const game = get().currentGame
        if (!game) return
        set({
          currentGame: { ...game, units: applyGrapple(game.units, id, otherId), updatedAt: now() },
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
          const action = decideAggressiveAction(u, u.hiddenAIOrder, game.units, game.windDirection)
          return {
            ...u,
            hiddenAIFirePlan: firePlan,
            hiddenAIAction: action,
            lastFireChunk: firePlan?.chunkIndex ?? u.lastFireChunk,
          }
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
        const moves: { unit: Unit; result: ReturnType<typeof applyMovementPlan> }[] = []

        for (let i = 0; i < units.length; i++) {
          const u = units[i]
          const plan = u.side === 'ai' ? u.hiddenAIOrder : u.playerOrder
          if (!plan) continue

          const result = applyMovementPlan(u, plan, game.windDirection)
          moves.push({ unit: u, result })
          units[i] = {
            ...u,
            position: result.position,
            orientation: result.orientation,
            attitude: result.attitude,
            prevAttitude: u.attitude,
            prevMoveDistance: result.distanceTraveled,
            isInIrons: result.isInIrons,
            hiddenAIOrder: null,
            playerOrder: null,
            hiddenAIFirePlan: null,
          }
        }

        // Log positions in the frame the player reads on screen: an offset from
        // the origin entity. Everything moves simultaneously, so the offsets are
        // only meaningful once every ship has been resolved — including the
        // origin ship itself, which may well have moved this turn.
        const resolved = { ...game, units }
        const logEntries: ActionLogEntry[] = moves.map(({ unit: u, result }) => {
          const drift = result.isInIrons ? ` (drifted ${u.driftSpeed}mm)` : ''
          const where = formatWorldPoint(
            sternMidpoint(result.position, result.orientation, u.baseLength),
            resolved,
          )
          return {
            turn: game.currentTurn,
            unitId: u.id,
            unitName: u.name,
            text: `${u.name} moved to ${where} heading ${result.orientation}pts${drift}`,
          }
        })

        const nextTurn = game.currentTurn + 1
        // The AI's grapple/board intent (hiddenAIAction) is only a suggestion,
        // shown during reveal like the fire plan — it is NOT auto-applied. The
        // player confirms an actual grapple via the unit panel. Clear the
        // suggestion now that the turn is resolving.
        set({
          currentGame: {
            ...game,
            units: units.map((u) => ({ ...u, hiddenAIAction: null })),
            actionLog: [...game.actionLog, ...logEntries],
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
      }),
    }
  )
)
