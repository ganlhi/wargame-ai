import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DriveFolder } from './driveClient'

export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'syncing'; what: 'pull' | 'push' }
  | { kind: 'ok'; at: string }
  | { kind: 'error'; message: string; at: string }
  /** Sync is set up but the Google token has lapsed; a click is needed to get another. */
  | { kind: 'signin' }

interface DriveSyncStore {
  /** A client ID entered in the app. Empty means "use the one the build was given". */
  clientIdOverride: string
  folder: DriveFolder | null
  /** Drive file ids by file name, so a save is one call. See `FileIdCache`. */
  fileIds: Record<string, string>
  lastSyncAt: string | null
  status: SyncStatus

  setClientIdOverride: (clientId: string) => void
  setFolder: (folder: DriveFolder | null) => void
  setFileId: (name: string, id: string) => void
  removeFileId: (name: string) => void
  clearFileIds: () => void
  setStatus: (status: SyncStatus) => void
  /** Forget the folder and everything learnt about it. The client ID stays: it is configuration, not a credential. */
  reset: () => void
}

/** The client ID baked into the build, if any. */
export const envClientId = (): string =>
  ((import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '').trim()

export const useDriveSyncStore = create<DriveSyncStore>()(
  persist(
    (set) => ({
      clientIdOverride: '',
      folder: null,
      fileIds: {},
      lastSyncAt: null,
      status: { kind: 'idle' },

      setClientIdOverride: (clientIdOverride) => set({ clientIdOverride }),
      setFolder: (folder) => set({ folder }),
      setFileId: (name, id) => set((s) => ({ fileIds: { ...s.fileIds, [name]: id } })),
      removeFileId: (name) =>
        set((s) => {
          const fileIds = { ...s.fileIds }
          delete fileIds[name]
          return { fileIds }
        }),
      clearFileIds: () => set({ fileIds: {} }),
      setStatus: (status) =>
        set(status.kind === 'ok' ? { status, lastSyncAt: status.at } : { status }),
      reset: () => set({ folder: null, fileIds: {}, lastSyncAt: null, status: { kind: 'idle' } }),
    }),
    {
      name: 'wargame-ai-drive-sync',
      partialize: (s) => ({
        clientIdOverride: s.clientIdOverride,
        folder: s.folder,
        fileIds: s.fileIds,
        lastSyncAt: s.lastSyncAt,
      }),
    },
  ),
)

export const effectiveClientId = (): string =>
  useDriveSyncStore.getState().clientIdOverride.trim() || envClientId()

/** Hook form of {@link effectiveClientId}, re-rendering when the override changes. */
export const useEffectiveClientId = (): string =>
  useDriveSyncStore((s) => s.clientIdOverride.trim() || envClientId())

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** One line for the user on where sync stands. */
export function describeStatus(status: SyncStatus, lastSyncAt: string | null): string {
  switch (status.kind) {
    case 'syncing':
      return status.what === 'pull' ? 'Loading games from Drive…' : 'Saving to Drive…'
    case 'ok':
      return `Synced at ${timeOf(status.at)}`
    case 'error':
      return `Sync failed: ${status.message}`
    case 'signin':
      return 'Sign in to Google to sync'
    case 'idle':
      return lastSyncAt ? `Last synced at ${timeOf(lastSyncAt)}` : 'Not synced yet'
  }
}
