import { describe, it, expect, beforeEach } from 'vitest'
import type { GameState, SavedGame } from '../types'
import { CURRENT_SCHEMA_VERSION } from '../stores/migrations'
import { DriveApiError, type DriveClient, type DriveFileMeta, type DriveFolder } from './driveClient'
import {
  DriveSyncer,
  INDEX_FILE,
  applySnapshot,
  collectLocalGames,
  gameFileName,
  summariseGame,
  type FileIdCache,
} from './driveSync'

class MemoryStorage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  key(i: number) { return [...this.data.keys()][i] ?? null }
  getItem(k: string) { return this.data.get(k) ?? null }
  setItem(k: string, v: string) { this.data.set(k, String(v)) }
  removeItem(k: string) { this.data.delete(k) }
  clear() { this.data.clear() }
}
const storage = () => new MemoryStorage() as unknown as Storage

/** An in-memory Drive: files keyed by id, each remembering its folder. */
class FakeDrive implements DriveClient {
  files = new Map<string, { name: string; parent: string; data: unknown }>()
  folders = new Map<string, DriveFolder & { parent: string }>()
  uploads = 0
  private seq = 0

  private nextId() { return `f${++this.seq}` }

  async listFolders(parentId: string): Promise<DriveFolder[]> {
    return [...this.folders.values()].filter((f) => f.parent === parentId).map(({ id, name }) => ({ id, name }))
  }
  async createFolder(parentId: string, name: string): Promise<DriveFolder> {
    const id = this.nextId()
    this.folders.set(id, { id, name, parent: parentId })
    return { id, name }
  }
  async listFiles(folderId: string): Promise<DriveFileMeta[]> {
    return [...this.files].filter(([, f]) => f.parent === folderId).map(([id, f]) => ({ id, name: f.name }))
  }
  async downloadJson(fileId: string): Promise<unknown> {
    const f = this.files.get(fileId)
    if (!f) throw new DriveApiError(404, 'File not found')
    return structuredClone(f.data)
  }
  async uploadJson(folderId: string, name: string, data: unknown, existingId?: string): Promise<string> {
    this.uploads++
    const copy = JSON.parse(JSON.stringify(data)) as unknown
    if (existingId) {
      const f = this.files.get(existingId)
      if (!f) throw new DriveApiError(404, 'File not found')
      f.data = copy
      return existingId
    }
    const id = this.nextId()
    this.files.set(id, { name, parent: folderId, data: copy })
    return id
  }
  async deleteFile(fileId: string): Promise<void> {
    if (!this.files.delete(fileId)) throw new DriveApiError(404, 'File not found')
  }

  byName(name: string) {
    return [...this.files.entries()].filter(([, f]) => f.name === name)
  }
}

class MapCache implements FileIdCache {
  map = new Map<string, string>()
  get(name: string) { return this.map.get(name) }
  set(name: string, id: string) { this.map.set(name, id) }
  remove(name: string) { this.map.delete(name) }
}

function makeGame(id: string, name: string, createdAt = '2026-01-01T00:00:00.000Z'): GameState {
  return {
    id,
    name,
    createdAt,
    updatedAt: createdAt,
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

const FOLDER = 'folder-1'

describe('DriveSyncer — pushing', () => {
  let drive: FakeDrive
  let cache: MapCache
  let syncer: DriveSyncer

  beforeEach(() => {
    drive = new FakeDrive()
    cache = new MapCache()
    syncer = new DriveSyncer(drive, FOLDER, cache)
  })

  it('writes a game file and the index, then updates both in place on the next save', async () => {
    const game = makeGame('a', 'Alpha')
    const index: SavedGame[] = [summariseGame(game)]
    await syncer.pushGame(game, index)
    expect(drive.byName(gameFileName('a'))).toHaveLength(1)
    expect(drive.byName(INDEX_FILE)).toHaveLength(1)

    const renamed = { ...game, name: 'Alpha II' }
    await syncer.pushGame(renamed, [summariseGame(renamed)])
    // Still one of each: the remembered ids were reused rather than new files made.
    expect(drive.files.size).toBe(2)
    const [, file] = drive.byName(gameFileName('a'))[0]
    expect((file.data as GameState).name).toBe('Alpha II')
    expect(drive.byName(INDEX_FILE)[0][1].data).toEqual([summariseGame(renamed)])
  })

  it('recovers from a remembered id that no longer exists', async () => {
    cache.set(INDEX_FILE, 'gone')
    await syncer.pushIndex([])
    const [id] = drive.byName(INDEX_FILE)[0]
    expect(cache.get(INDEX_FILE)).toBe(id)
  })

  it('finds a file another device already created instead of duplicating it', async () => {
    const other = new DriveSyncer(drive, FOLDER, new MapCache())
    await other.pushIndex([])
    await syncer.pushIndex([{ id: 'x', name: 'X', createdAt: '', updatedAt: '', unitCount: 0 }])
    expect(drive.byName(INDEX_FILE)).toHaveLength(1)
    expect(drive.byName(INDEX_FILE)[0][1].data).toHaveLength(1)
  })

  it('seeds a folder with every local game', async () => {
    const games = [makeGame('a', 'Alpha'), makeGame('b', 'Bravo')]
    await syncer.pushAll(games, games.map(summariseGame))
    expect(drive.files.size).toBe(3)
  })

  it('deletes a game file and rewrites the index, tolerating a game with no file', async () => {
    const a = makeGame('a', 'Alpha')
    const b = makeGame('b', 'Bravo')
    await syncer.pushAll([a, b], [a, b].map(summariseGame))

    await syncer.deleteGame('a', [summariseGame(b)])
    expect(drive.byName(gameFileName('a'))).toHaveLength(0)
    expect(drive.byName(INDEX_FILE)[0][1].data).toEqual([summariseGame(b)])
    expect(cache.get(gameFileName('a'))).toBeUndefined()

    await expect(syncer.deleteGame('never-pushed', [summariseGame(b)])).resolves.toBeUndefined()
  })
})

describe('DriveSyncer — pulling', () => {
  let drive: FakeDrive
  let syncer: DriveSyncer

  beforeEach(() => {
    drive = new FakeDrive()
    syncer = new DriveSyncer(drive, FOLDER, new MapCache())
  })

  it('returns null for a folder holding nothing of the app, even with other files in it', async () => {
    await drive.uploadJson(FOLDER, 'notes.json', { hello: 'world' })
    expect(await syncer.pull()).toBeNull()
    expect(await syncer.countRemoteGames()).toBe(0)
  })

  it('orders games by the index, appends unlisted ones, and drops entries with no file', async () => {
    const a = makeGame('a', 'Alpha', '2026-01-01T00:00:00.000Z')
    const b = makeGame('b', 'Bravo', '2026-01-02T00:00:00.000Z')
    const c = makeGame('c', 'Charlie', '2026-01-03T00:00:00.000Z')
    for (const g of [a, b, c]) await drive.uploadJson(FOLDER, gameFileName(g.id), g)
    const ghost: SavedGame = { id: 'ghost', name: 'Ghost', createdAt: '', updatedAt: '', unitCount: 0 }
    // The index knows b and a (in that order), a game that no longer exists,
    // and nothing about c. It also carries a stale unit count for b.
    await drive.uploadJson(FOLDER, INDEX_FILE, [
      { ...summariseGame(b), unitCount: 99 },
      summariseGame(a),
      ghost,
    ])

    const snapshot = await syncer.pull()
    expect(snapshot).not.toBeNull()
    expect(snapshot!.savedGames.map((g) => g.id)).toEqual(['b', 'a', 'c'])
    expect(snapshot!.savedGames[0].unitCount).toBe(0)
    expect([...snapshot!.games.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect(await syncer.countRemoteGames()).toBe(3)
  })

  it('rebuilds the list from game files alone when there is no index', async () => {
    const a = makeGame('a', 'Alpha')
    await drive.uploadJson(FOLDER, gameFileName('a'), a)
    const snapshot = await syncer.pull()
    expect(snapshot!.savedGames).toEqual([summariseGame(a)])
  })

  it('skips a game file that is not a game', async () => {
    await drive.uploadJson(FOLDER, gameFileName('junk'), 'not an object')
    await drive.uploadJson(FOLDER, gameFileName('a'), makeGame('a', 'Alpha'))
    const snapshot = await syncer.pull()
    expect(snapshot!.savedGames.map((g) => g.id)).toEqual(['a'])
  })
})

describe('local storage side', () => {
  it('applySnapshot replaces local games, removes stale ones and leaves other keys alone', () => {
    const local = storage()
    local.setItem('game-old', JSON.stringify(makeGame('old', 'Old')))
    local.setItem('game-a', JSON.stringify(makeGame('a', 'Stale Alpha')))
    local.setItem('wargame-ai-store', '{"keep":true}')

    const a = makeGame('a', 'Alpha')
    const b = makeGame('b', 'Bravo')
    const savedGames = applySnapshot(
      { savedGames: [a, b].map(summariseGame), games: new Map([['a', a], ['b', b]]) },
      local,
    )

    expect(savedGames.map((g) => g.id)).toEqual(['a', 'b'])
    expect(local.getItem('game-old')).toBeNull()
    expect(JSON.parse(local.getItem('game-a')!).name).toBe('Alpha')
    expect(JSON.parse(local.getItem('game-b')!).name).toBe('Bravo')
    expect(local.getItem('wargame-ai-store')).toBe('{"keep":true}')
  })

  it('collectLocalGames returns the games that are actually stored, in list order', () => {
    const local = storage()
    const a = makeGame('a', 'Alpha')
    const b = makeGame('b', 'Bravo')
    local.setItem('game-a', JSON.stringify(a))
    local.setItem('game-b', JSON.stringify(b))
    const listed = [b, a, makeGame('missing', 'Missing')].map(summariseGame)
    expect(collectLocalGames(listed, local).map((g) => g.id)).toEqual(['b', 'a'])
  })
})
