import type { GameState, SavedGame } from '../types'
import { migrateSavedGame } from '../stores/migrations'
import { DriveApiError, type DriveClient } from './driveClient'

/**
 * What the app keeps in the Drive folder mirrors what it keeps in local
 * storage: one index file listing the games, and one file per game holding
 * its full state. Saving a game rewrites its own file and the index; loading
 * from Drive reads everything and replaces the local copies wholesale — Drive
 * is the source of truth once sync is set up.
 */
export const INDEX_FILE = 'games.json'
export const gameFileName = (id: string): string => `game-${id}.json`
const GAME_FILE = /^game-(.+)\.json$/
/** Local storage key a game is kept under, matching what the game store reads. */
export const localGameKey = (id: string): string => `game-${id}`

/**
 * Drive addresses files by id, not name, so the id of each of the app's files
 * is remembered between saves; a save is then a single update call rather than
 * a search followed by a write. The cache is only an optimisation: a stale id
 * is caught and re-resolved by listing the folder.
 */
export interface FileIdCache {
  get(name: string): string | undefined
  set(name: string, id: string): void
  remove(name: string): void
}

export interface RemoteSnapshot {
  savedGames: SavedGame[]
  games: Map<string, GameState>
}

export function summariseGame(game: GameState): SavedGame {
  return {
    id: game.id,
    name: game.name,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    unitCount: game.units.length,
  }
}

export class DriveSyncer {
  private readonly client: DriveClient
  private readonly folderId: string
  private readonly cache: FileIdCache

  constructor(client: DriveClient, folderId: string, cache: FileIdCache) {
    this.client = client
    this.folderId = folderId
    this.cache = cache
  }

  /** Push one game and the index that lists it — what a Save does. */
  async pushGame(game: GameState, savedGames: SavedGame[]): Promise<void> {
    await this.upload(gameFileName(game.id), game)
    await this.upload(INDEX_FILE, savedGames)
  }

  async pushIndex(savedGames: SavedGame[]): Promise<void> {
    await this.upload(INDEX_FILE, savedGames)
  }

  /** Seed an empty folder with everything held locally. */
  async pushAll(games: GameState[], savedGames: SavedGame[]): Promise<void> {
    for (const game of games) {
      await this.upload(gameFileName(game.id), game)
    }
    await this.upload(INDEX_FILE, savedGames)
  }

  /** Remove a game's file and rewrite the index without it. A game with no file on Drive is not an error. */
  async deleteGame(id: string, savedGames: SavedGame[]): Promise<void> {
    const name = gameFileName(id)
    let fileId = this.cache.get(name)
    if (!fileId) {
      await this.refreshFileIds()
      fileId = this.cache.get(name)
    }
    if (fileId) {
      try {
        await this.client.deleteFile(fileId)
      } catch (e) {
        if (!(e instanceof DriveApiError && e.status === 404)) throw e
      }
      this.cache.remove(name)
    }
    await this.pushIndex(savedGames)
  }

  /** How many game files the folder holds, so a folder with data can be told apart from a fresh one before committing to it. */
  async countRemoteGames(): Promise<number> {
    const files = await this.refreshFileIds()
    return files.filter((f) => GAME_FILE.test(f.name)).length
  }

  /**
   * Everything the folder holds, or null when it holds nothing of the app's —
   * in which case there is nothing to replace local state with.
   *
   * The index is trusted for ordering only. Each game's entry is rebuilt from
   * the game file itself, a game file the index does not mention is appended,
   * and an index entry with no file behind it is dropped: the list must never
   * offer a game that cannot be opened.
   */
  async pull(): Promise<RemoteSnapshot | null> {
    const files = await this.refreshFileIds()
    const indexFile = files.find((f) => f.name === INDEX_FILE)
    const gameFiles = files.filter((f) => GAME_FILE.test(f.name))
    if (!indexFile && gameFiles.length === 0) return null

    const games = new Map<string, GameState>()
    await Promise.all(
      gameFiles.map(async (f) => {
        const raw = await this.client.downloadJson(f.id)
        const game = parseGame(raw)
        if (game) games.set(game.id, game)
      }),
    )

    const listed: string[] = []
    if (indexFile) {
      const rawIndex = await this.client.downloadJson(indexFile.id)
      if (Array.isArray(rawIndex)) {
        for (const entry of rawIndex) {
          const id = (entry as { id?: unknown })?.id
          if (typeof id === 'string' && games.has(id) && !listed.includes(id)) listed.push(id)
        }
      }
    }
    const unlisted = [...games.keys()]
      .filter((id) => !listed.includes(id))
      .sort((a, b) => games.get(a)!.createdAt.localeCompare(games.get(b)!.createdAt))

    const savedGames = [...listed, ...unlisted].map((id) => summariseGame(games.get(id)!))
    return { savedGames, games }
  }

  private async refreshFileIds(): Promise<{ id: string; name: string }[]> {
    const files = await this.client.listFiles(this.folderId)
    for (const f of files) {
      if (f.name === INDEX_FILE || GAME_FILE.test(f.name)) this.cache.set(f.name, f.id)
    }
    return files
  }

  private async upload(name: string, data: unknown): Promise<void> {
    const cached = this.cache.get(name)
    if (cached) {
      try {
        await this.client.uploadJson(this.folderId, name, data, cached)
        return
      } catch (e) {
        // The file was deleted or moved out from under us; look it up afresh.
        if (!(e instanceof DriveApiError && e.status === 404)) throw e
        this.cache.remove(name)
      }
    }
    await this.refreshFileIds()
    const id = await this.client.uploadJson(this.folderId, name, data, this.cache.get(name))
    this.cache.set(name, id)
  }
}

/** A game file's contents through the same migration local saves get; null if it is not a game at all. */
function parseGame(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  try {
    const game = migrateSavedGame(raw as Parameters<typeof migrateSavedGame>[0])
    return typeof game.id === 'string' && typeof game.name === 'string' ? game : null
  } catch {
    return null
  }
}

/**
 * Make local storage match a snapshot: every game in it is written, every
 * local game not in it is removed, and nothing else in storage is touched.
 * Returns the game list for the store to adopt.
 */
export function applySnapshot(snapshot: RemoteSnapshot, storage: Storage): SavedGame[] {
  const keep = new Set([...snapshot.games.keys()].map(localGameKey))
  const stale: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key && key.startsWith('game-') && !keep.has(key)) stale.push(key)
  }
  for (const key of stale) storage.removeItem(key)
  for (const [id, game] of snapshot.games) {
    storage.setItem(localGameKey(id), JSON.stringify(game))
  }
  return snapshot.savedGames
}

/** The full state of every listed game that local storage actually holds. */
export function collectLocalGames(savedGames: SavedGame[], storage: Storage): GameState[] {
  const games: GameState[] = []
  for (const entry of savedGames) {
    const raw = storage.getItem(localGameKey(entry.id))
    if (!raw) continue
    try {
      const game = parseGame(JSON.parse(raw))
      if (game) games.push(game)
    } catch {
      // A corrupt local save is skipped rather than aborting the whole seed.
    }
  }
  return games
}
