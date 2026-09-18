import { useEffect, useMemo, useState } from 'react'
import { useGameStore } from '../stores/gameStore'
import { ROOT_FOLDER, type DriveFolder } from '../sync/driveClient'
import { envClientId, useDriveSyncStore } from '../sync/syncStore'
import { hasValidToken, preloadGoogleIdentity, renewAccessTokenSilently } from '../sync/googleAuth'
import {
  NeedsSignInError,
  browseClient,
  connectFolder,
  countRemoteGames,
  signIn,
} from '../sync/syncActions'

interface DriveSyncModalProps {
  onClose: () => void
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const input =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500'
const button =
  'text-sm font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
const primary = `${button} bg-blue-600 hover:bg-blue-500 text-white`
const secondary = `${button} border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500`
const plain = `${button} text-gray-400 hover:text-gray-200`

/**
 * Setting up Drive sync: the OAuth client ID, a Google sign-in, and a walk
 * through the user's folders to the one the games should live in.
 */
export function DriveSyncModal({ onClose }: DriveSyncModalProps) {
  const { clientIdOverride, setClientIdOverride, folder: currentFolder } = useDriveSyncStore()
  const localCount = useGameStore((s) => s.savedGames.length)

  const [draft, setDraft] = useState(clientIdOverride)
  const clientId = draft.trim() || envClientId()
  const [signedIn, setSignedIn] = useState(() => !!clientId && hasValidToken(clientId))
  const [path, setPath] = useState<DriveFolder[]>([ROOT_FOLDER])
  const [listing, setListing] = useState<{ folderId: string; folders: DriveFolder[] } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ remote: number } | null>(null)

  const client = useMemo(() => browseClient(), [])
  const current = path[path.length - 1]
  const loading = signedIn && !error && listing?.folderId !== current.id
  const folders = listing?.folderId === current.id ? listing.folders : []

  // Have the Google script in hand before the sign-in click, so the popup
  // opens inside the click rather than after a download the browser may not
  // count as part of it. With it loaded, a lapsed token is worth a silent
  // renewal before the user is shown a sign-in button they need not press.
  // Only the client ID the dialog opened with: one being typed in is a partial
  // one for most of its keystrokes, and not worth a request each.
  const [openedWith] = useState(clientId)
  useEffect(() => {
    let cancelled = false
    void preloadGoogleIdentity()
      .then(() =>
        openedWith && !hasValidToken(openedWith) ? renewAccessTokenSilently(openedWith) : null,
      )
      .then((token) => {
        if (token && !cancelled) setSignedIn(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [openedWith])

  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    client.listFolders(current.id).then(
      (found) => {
        if (!cancelled) setListing({ folderId: current.id, folders: found })
      },
      (e: unknown) => {
        if (cancelled) return
        setError(messageOf(e))
        if (e instanceof NeedsSignInError) setSignedIn(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [client, current.id, signedIn, attempt])

  const handleDraftChange = (value: string) => {
    setDraft(value)
    const id = value.trim() || envClientId()
    setSignedIn(!!id && hasValidToken(id))
  }

  const handleSignIn = async () => {
    setClientIdOverride(draft.trim())
    setBusy(true)
    setError(null)
    try {
      await signIn()
      setSignedIn(true)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const navigate = (next: DriveFolder[]) => {
    setError(null)
    setNewFolderName(null)
    setPath(next)
  }

  const retry = () => {
    setError(null)
    setAttempt((n) => n + 1)
  }

  const handleCreateFolder = async () => {
    const name = newFolderName?.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      const created = await client.createFolder(current.id, name)
      setNewFolderName(null)
      setPath([...path, created])
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    setBusy(true)
    try {
      await connectFolder(current)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const handleUseFolder = async () => {
    setBusy(true)
    setError(null)
    try {
      const remote = await countRemoteGames(current.id)
      if (remote > 0 && localCount > 0) {
        setConfirm({ remote })
        return
      }
      await finish()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md max-h-[90svh] overflow-y-auto p-5 flex flex-col gap-4">
        <h3 className="text-lg font-semibold">Google Drive sync</h3>

        {confirm ? (
          <>
            <p className="text-sm text-gray-300">
              <span className="font-medium">{current.name}</span> already holds{' '}
              {plural(confirm.remote, 'game')} on Drive. Loading them will replace the{' '}
              {plural(localCount, 'game')} saved on this device.
            </p>
            <p className="text-xs text-gray-500">
              To keep the games on this device instead, pick an empty folder: they will be
              uploaded there.
            </p>
            <div className="flex flex-col gap-2">
              <button className={primary} disabled={busy} onClick={() => void finish()}>
                Replace local games with Drive
              </button>
              <button className={plain} disabled={busy} onClick={() => setConfirm(null)}>
                Back
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">OAuth client ID</label>
              <input
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                placeholder={
                  envClientId()
                    ? 'Using the client ID this build was given'
                    : '…apps.googleusercontent.com'
                }
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className={input}
              />
              <p className="text-xs text-gray-500 mt-1">
                A “Web application” OAuth client from the Google Cloud console, with this site
                listed under its authorised JavaScript origins.
              </p>
            </div>

            {currentFolder && (
              <p className="text-xs text-gray-500">
                Currently syncing to <span className="text-gray-300">{currentFolder.name}</span>.
              </p>
            )}

            {!signedIn ? (
              <button className={primary} disabled={!clientId || busy} onClick={() => void handleSignIn()}>
                Sign in with Google
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="text-xs text-gray-400 flex flex-wrap items-center gap-1">
                  {path.map((f, i) => (
                    <span key={f.id} className="flex items-center gap-1">
                      {i > 0 && <span className="text-gray-600">/</span>}
                      <button
                        onClick={() => navigate(path.slice(0, i + 1))}
                        disabled={i === path.length - 1}
                        className="hover:text-gray-200 disabled:text-gray-200 disabled:font-medium cursor-pointer disabled:cursor-default"
                      >
                        {f.name}
                      </button>
                    </span>
                  ))}
                </div>

                <ul className="border border-gray-800 rounded-lg divide-y divide-gray-800 max-h-56 overflow-y-auto">
                  {loading && <li className="px-3 py-2 text-sm text-gray-500">Loading folders…</li>}
                  {!loading && !error && folders.length === 0 && (
                    <li className="px-3 py-2 text-sm text-gray-500">No subfolders</li>
                  )}
                  {!loading &&
                    folders.map((f) => (
                      <li key={f.id}>
                        <button
                          onClick={() => navigate([...path, f])}
                          className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 transition-colors cursor-pointer flex items-center gap-2"
                        >
                          <span aria-hidden="true">📁</span>
                          <span className="truncate">{f.name}</span>
                        </button>
                      </li>
                    ))}
                </ul>

                {newFolderName === null ? (
                  <div className="flex gap-2 flex-wrap">
                    <button className={secondary} disabled={busy || loading} onClick={() => setNewFolderName('')}>
                      New folder here
                    </button>
                    <button className={`${primary} flex-1`} disabled={busy || loading} onClick={() => void handleUseFolder()}>
                      Use “{current.name}”
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void handleCreateFolder()}
                      placeholder="Folder name"
                      className={input}
                    />
                    <button className={primary} disabled={busy || !newFolderName.trim()} onClick={() => void handleCreateFolder()}>
                      Create
                    </button>
                    <button className={plain} onClick={() => setNewFolderName(null)}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="text-sm text-red-400">
                {error}
                {signedIn && (
                  <>
                    {' '}
                    <button onClick={retry} className="underline cursor-pointer">
                      Retry
                    </button>
                  </>
                )}
              </p>
            )}

            <div className="flex justify-end">
              <button className={plain} onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
