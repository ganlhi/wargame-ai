import { useGameStore } from '../stores/gameStore'
import { useShipTemplateStore } from '../stores/shipTemplateStore'
import type { GameState, ShipSettings, ShipTemplate } from '../types'
import { useDriveSyncStore, effectiveClientId } from './syncStore'
import { createDriveClient, DriveApiError, type DriveClient, type DriveFolder } from './driveClient'
import {
  DriveSyncer,
  applySnapshot,
  collectLocalGames,
  localGameKey,
  type FileIdCache,
  type RemoteSnapshot,
} from './driveSync'
import {
  clearStoredToken,
  getAccessToken,
  hasValidToken,
  preloadGoogleIdentity,
  revokeToken,
} from './googleAuth'

/**
 * Where the game store meets Google Drive. Every entry point here first does
 * the local thing — save, delete — exactly as before, then mirrors it to the
 * folder in the background; the local app never waits on the network, and a
 * failed sync is reported in the status rather than undoing anything.
 *
 * Sync work runs one job at a time. Two quick saves must not race each other
 * to the same file, and a pull must never interleave with a push.
 */

export class NeedsSignInError extends Error {
  constructor() {
    super('Sign in to Google to continue')
    this.name = 'NeedsSignInError'
  }
}

/**
 * Background work can only use a token that is already in hand: a popup can
 * be opened from a click, not from a save that is running after one.
 */
const nonInteractiveToken = async (): Promise<string> => {
  const token = await getAccessToken(effectiveClientId(), { interactive: false })
  if (!token) throw new NeedsSignInError()
  return token
}

/** A client for the settings dialog to browse folders with. */
export function browseClient(): DriveClient {
  return createDriveClient(nonInteractiveToken)
}

const storeCache: FileIdCache = {
  get: (name) => useDriveSyncStore.getState().fileIds[name],
  set: (name, id) => useDriveSyncStore.getState().setFileId(name, id),
  remove: (name) => useDriveSyncStore.getState().removeFileId(name),
}
const noCache: FileIdCache = { get: () => undefined, set: () => {}, remove: () => {} }

export const isSyncConfigured = (): boolean =>
  !!useDriveSyncStore.getState().folder && !!effectiveClientId()

/** How many games a folder already holds, asked before it is adopted. */
export function countRemoteGames(folderId: string): Promise<number> {
  return new DriveSyncer(browseClient(), folderId, noCache).countRemoteGames()
}

export function reportSyncError(e: unknown): void {
  const store = useDriveSyncStore.getState()
  if (e instanceof NeedsSignInError || (e instanceof DriveApiError && e.status === 401)) {
    clearStoredToken()
    store.setStatus({ kind: 'signin' })
    return
  }
  store.setStatus({
    kind: 'error',
    message: e instanceof Error ? e.message : String(e),
    at: new Date().toISOString(),
  })
}

let queue: Promise<unknown> = Promise.resolve()

function run<T>(
  what: 'pull' | 'push',
  job: (syncer: DriveSyncer) => Promise<T>,
): Promise<T | undefined> {
  const { folder } = useDriveSyncStore.getState()
  if (!folder || !effectiveClientId()) return Promise.resolve(undefined)
  const task = queue.then(async () => {
    useDriveSyncStore.getState().setStatus({ kind: 'syncing', what })
    try {
      const syncer = new DriveSyncer(createDriveClient(nonInteractiveToken), folder.id, storeCache)
      const result = await job(syncer)
      useDriveSyncStore.getState().setStatus({ kind: 'ok', at: new Date().toISOString() })
      return result
    } catch (e) {
      reportSyncError(e)
      return undefined
    }
  })
  queue = task.catch(() => undefined)
  return task
}

/** The Save button: write the open game locally, then mirror it and the game list to Drive. */
export function saveGame(): void {
  useGameStore.getState().saveCurrentGame()
  const { currentGame, savedGames } = useGameStore.getState()
  if (!currentGame) return
  void run('push', (s) => s.pushGame(currentGame, savedGames))
}

/**
 * Mirror the open game's last *saved* state — used after a sign-in restores
 * access, so unsaved edits on screen are not pushed ahead of a Save.
 */
export function pushCurrentGame(): void {
  const { currentGame, savedGames } = useGameStore.getState()
  const stored = currentGame ? localStorage.getItem(localGameKey(currentGame.id)) : null
  if (!stored) {
    void run('push', (s) => s.pushIndex(savedGames))
    return
  }
  const game = JSON.parse(stored) as GameState
  void run('push', (s) => s.pushGame(game, savedGames))
}

/** Delete a game here and on Drive. */
export function deleteGame(id: string): void {
  useGameStore.getState().deleteGame(id)
  const { savedGames } = useGameStore.getState()
  void run('push', (s) => s.deleteGame(id, savedGames))
}

/** Save a ship's settings to the library here, then mirror the whole library to Drive. See the store for what `id` does. */
export function saveShipTemplate(name: string, settings: ShipSettings, id?: string): ShipTemplate {
  const template = useShipTemplateStore.getState().saveTemplate(name, settings, id)
  pushTemplates()
  return template
}

/** Drop a saved ship here and on Drive. */
export function deleteShipTemplate(id: string): void {
  useShipTemplateStore.getState().removeTemplate(id)
  pushTemplates()
}

function pushTemplates(): void {
  const { templates } = useShipTemplateStore.getState()
  void run('push', (s) => s.pushTemplates(templates))
}

/**
 * Make this device match what the folder holds. Games are replaced outright.
 * The saved ships are too when the folder has a library — but a folder with
 * none keeps the local library and is given a copy of it, so ships saved
 * before sync was set up are not lost to a device that never had them.
 */
async function adoptSnapshot(s: DriveSyncer, snapshot: RemoteSnapshot): Promise<void> {
  const savedGames = applySnapshot(snapshot, localStorage)
  useGameStore.setState({ savedGames })
  const templateStore = useShipTemplateStore.getState()
  if (snapshot.templates) {
    templateStore.replaceAll(snapshot.templates)
  } else if (templateStore.templates.length > 0) {
    await s.pushTemplates(templateStore.templates)
  }
}

export type PullResult = 'replaced' | 'empty'

/**
 * Replace the local games with what the folder holds. A folder with nothing
 * of the app's in it leaves local state alone: an empty Drive is far more
 * likely to be a fresh setup than a wish to wipe every game on this device.
 */
export function pullFromDrive(): Promise<PullResult | undefined> {
  return run('pull', async (s) => {
    const snapshot = await s.pull()
    if (!snapshot) return 'empty'
    await adoptSnapshot(s, snapshot)
    return 'replaced'
  })
}

/** Open the Google popup for a fresh token. Call from a click handler. */
export async function signIn(): Promise<void> {
  const clientId = effectiveClientId()
  if (!clientId) throw new Error('Enter a Google OAuth client ID first')
  await getAccessToken(clientId, { interactive: true })
  const store = useDriveSyncStore.getState()
  if (store.status.kind === 'signin') store.setStatus({ kind: 'idle' })
}

export type ConnectResult = 'pulled' | 'seeded'

/**
 * Adopt a folder. One that already holds games becomes the source of truth
 * and replaces local state; an empty one is seeded with the local games.
 */
export function connectFolder(folder: DriveFolder): Promise<ConnectResult | undefined> {
  const store = useDriveSyncStore.getState()
  store.setFolder(folder)
  store.clearFileIds()
  return run('pull', async (s) => {
    const snapshot = await s.pull()
    if (snapshot) {
      await adoptSnapshot(s, snapshot)
      return 'pulled'
    }
    const { savedGames } = useGameStore.getState()
    const { templates } = useShipTemplateStore.getState()
    await s.pushAll(collectLocalGames(savedGames, localStorage), savedGames, templates)
    return 'seeded'
  })
}

/** Stop syncing and sign out. Local games and the files on Drive are both left as they are. */
export function disconnect(): void {
  revokeToken()
  useDriveSyncStore.getState().reset()
}

let started = false

/**
 * On app load, take the games from Drive. Without a usable token the app can
 * only ask for a click, so it flags that and waits.
 */
export function startupSync(): void {
  if (started) return
  started = true
  if (!isSyncConfigured()) return
  void preloadGoogleIdentity().catch(() => {})
  if (!hasValidToken(effectiveClientId())) {
    useDriveSyncStore.getState().setStatus({ kind: 'signin' })
    return
  }
  void pullFromDrive()
}
