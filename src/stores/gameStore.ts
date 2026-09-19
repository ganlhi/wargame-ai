import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'
import type { SavedGame, GameState, TableTerrain, Unit, Scale, WindStrength } from '../types'
import { applyMovementPlan, tackTurnDirection } from '../game/movement'
import { suggestMovement } from '../game/ai'
import { migrateSavedGame, CURRENT_SCHEMA_VERSION } from './migrations'
import { conditionsOf, resolveGame, resolveUnit } from '../game/shipStats'

interface GameStore {
  savedGames: SavedGame[]
  currentGame: GameState | null
  hasUnsavedChanges: boolean

  createGame: (name: string, scale: Scale) => string
  loadGame: (id: string) => void
  deleteGame: (id: string) => void
  saveCurrentGame: () => void
  exitToMenu: () => void
  markChanged: () => void

  setWindDirection: (direction: number) => void
  setWindStrength: (strength: WindStrength) => void
  /** Only while no ship is on the table: every distance is read against it. */
  setScale: (scale: Scale) => void
  /** Re-anchor every bearing on another ship. Terrain cannot be the origin. */
  setOrigin: (id: string) => void

  /** Place a terrain piece. Refused (false) until a ship is on the table to measure it from. */
  addTerrain: (terrain: Omit<TableTerrain, 'id'>) => boolean
  updateTerrain: (id: string, updates: Partial<TableTerrain>) => void
  removeTerrain: (id: string) => void

  addUnit: (unit: Unit) => void
  updateUnit: (id: string, updates: Partial<Unit>) => void
  /** Remove a ship. Refused (false) for the last ship while terrain still needs an origin. */
  removeUnit: (id: string) => boolean

  /** Lay and show the AI's orders for the table as it is now described. */
  revealOrders: () => void
  /** Clear the revealed orders, the AI remembering what it needs of them, and start describing the next turn. */
  nextTurn: () => void
}

const now = () => new Date().toISOString()

function createInitialGame(name: string, scale: Scale): GameState {
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
    windStrength: 'moderate_breeze',
    scale,
    terrain: [],
    units: [],
    phase: 'input',
  }
}

/**
 * Revealed orders are a snapshot of the table as it was described. Once
 * anything they were planned against changes — a position, a heading, the
 * wind, a terrain piece, a ship's style or settings — they no longer hold, so
 * they are dropped and the turn goes back to being described. Nothing is
 * remembered from them: the AI only records an order it has seen carried out,
 * which is what *Next turn* means.
 */
function withOrdersDiscarded(game: GameState): GameState {
  if (game.phase !== 'orders') return game
  return {
    ...game,
    phase: 'input',
    units: game.units.map((u) => (u.aiOrder ? { ...u, aiOrder: null } : u)),
  }
}

/**
 * The tack a ship is in as her orders are laid, read against the heading the
 * player has just entered. Head to wind she is in the procedure: swinging the
 * way she was already swinging, or, if the app has no record of that, toward
 * the bow the wind is on. Off the wind she is out of it, whatever the AI
 * expected — the table is the truth. A ship that may not tack is never in the
 * procedure at all: head to wind she simply drifts.
 */
function withTackState(unit: Unit, windDirection: number): Unit {
  const tackDirection =
    unit.isInIrons && !unit.tackingForbidden
      ? unit.tackDirection ?? tackTurnDirection(unit.orientation, windDirection)
      : null
  return tackDirection === unit.tackDirection ? unit : { ...unit, tackDirection }
}

const canAct = (u: Unit) => u.status !== 'destroyed' && u.status !== 'surrendered'

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => {
      /** Commit a changed game, re-rating every ship against it. */
      const commit = (game: GameState) =>
        set({ currentGame: resolveGame({ ...game, updatedAt: now() }), hasUnsavedChanges: true })

      return {
        savedGames: [],
        currentGame: null,
        hasUnsavedChanges: false,

        createGame: (name, scale) => {
          const game = createInitialGame(name, scale)
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
            const game = resolveGame(migrateSavedGame(JSON.parse(stored)))
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
                : g,
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

        setOrigin: (id) => {
          const game = get().currentGame
          if (!game || !game.units.some((u) => u.id === id)) return
          // Nothing on the table moves — only the ship the bearings are read from.
          commit({ ...game, originId: id })
        },

        setWindDirection: (direction) => {
          const game = get().currentGame
          if (!game || game.windDirection === direction) return
          commit(withOrdersDiscarded({ ...game, windDirection: direction }))
        },

        /**
         * Change the weather. Every ship's speeds are read from the charts
         * against it, so the whole fleet is re-rated on the spot — and any
         * orders already revealed were measured against speeds that no longer
         * apply, so they go too.
         */
        setWindStrength: (strength) => {
          const game = get().currentGame
          if (!game || game.windStrength === strength) return
          commit(withOrdersDiscarded({ ...game, windStrength: strength }))
        },

        setScale: (scale) => {
          const game = get().currentGame
          if (!game || game.scale === scale || game.units.length > 0) return
          commit({ ...game, scale })
        },

        addTerrain: (spec) => {
          const game = get().currentGame
          // Terrain is placed by its bearing from the origin ship, so there
          // has to be one before any terrain can be described.
          if (!game || !game.originId) return false
          const terrain: TableTerrain = { ...spec, id: uuid() }
          commit(withOrdersDiscarded({ ...game, terrain: [...game.terrain, terrain] }))
          return true
        },

        updateTerrain: (id, updates) => {
          const game = get().currentGame
          if (!game) return
          commit(withOrdersDiscarded({
            ...game,
            terrain: game.terrain.map((t) => (t.id === id ? { ...t, ...updates } : t)),
          }))
        },

        removeTerrain: (id) => {
          const game = get().currentGame
          if (!game) return
          commit(withOrdersDiscarded({ ...game, terrain: game.terrain.filter((t) => t.id !== id) }))
        },

        addUnit: (unit) => {
          const game = get().currentGame
          if (!game) return
          commit(withOrdersDiscarded({
            ...game,
            units: [...game.units, resolveUnit(unit, conditionsOf(game))],
            // The first ship placed is the origin every bearing is read from.
            originId: game.originId ?? unit.id,
          }))
        },

        /**
         * Status is bookkeeping the player does while resolving the turn the
         * revealed orders belong to, so it leaves the orders standing.
         * Anything else changes what the AI planned against.
         */
        updateUnit: (id, updates) => {
          const game = get().currentGame
          if (!game) return
          const bookkeeping = Object.keys(updates).every((k) => k === 'status')
          const next: GameState = {
            ...game,
            units: game.units.map((u) => (u.id === id ? { ...u, ...updates } : u)),
          }
          commit(bookkeeping ? next : withOrdersDiscarded(next))
        },

        removeUnit: (id) => {
          const game = get().currentGame
          if (!game || !game.units.some((u) => u.id === id)) return false
          // The terrain is measured from a ship; with none left it would have
          // nothing to be measured from.
          if (game.units.length === 1 && game.terrain.length > 0) return false
          const units = game.units.filter((u) => u.id !== id)
          commit(withOrdersDiscarded({
            ...game,
            units,
            // A destroyed or surrendered ship is still a model on the table and
            // stays a valid origin; only removing her from the game hands the
            // anchor to the next ship.
            originId: game.originId === id ? units[0]?.id ?? null : game.originId,
          }))
          return true
        },

        revealOrders: () => {
          const game = get().currentGame
          if (!game) return
          const wind = game.windDirection
          const units = game.units.map((u) => (u.side === 'ai' ? withTackState(u, wind) : u))
          const ordered = units.map((u) => {
            if (u.side !== 'ai') return u
            if (!canAct(u)) return u.aiOrder ? { ...u, aiOrder: null } : u
            const order = suggestMovement(u, units, game.terrain, wind, u.prevAttitude, 1)
            return { ...u, aiOrder: order }
          })
          commit({ ...game, units: ordered, phase: 'orders' })
        },

        /**
         * The orders have been carried out on the table. Before they go, each
         * AI ship records what the movement rules will ask about her previous
         * turn: how far she sailed (half of it is next turn's minimum), what
         * her attitude was as the orders were laid (a tack needs a whole turn
         * spent beating) and the way she is swinging if a tack is under way.
         * Nothing is recorded about where anyone is: that is for the player
         * to enter afresh.
         */
        nextTurn: () => {
          const game = get().currentGame
          if (!game || game.phase !== 'orders') return
          const units = game.units.map((u): Unit => {
            if (u.side !== 'ai' || !canAct(u)) {
              return u.aiOrder ? { ...u, aiOrder: null } : u
            }
            const result = u.aiOrder ? applyMovementPlan(u, u.aiOrder, game.windDirection) : null
            return {
              ...u,
              prevAttitude: u.attitude,
              // A ship that could not be given an order did not sail.
              prevMoveDistance: result ? result.distanceTraveled : 0,
              tackDirection: result ? result.tackDirection : u.tackDirection,
              aiOrder: null,
            }
          })
          commit({ ...game, units, phase: 'input' })
        },
      }
    },
    {
      name: 'wargame-ai-store',
      partialize: (state) => ({
        savedGames: state.savedGames,
      }),
    }
  )
)
