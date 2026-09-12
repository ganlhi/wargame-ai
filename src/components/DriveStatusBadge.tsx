import { useState } from 'react'
import { describeStatus, useDriveSyncStore, useEffectiveClientId } from '../sync/syncStore'
import { pushCurrentGame, reportSyncError, signIn } from '../sync/syncActions'

/**
 * A compact word in the game header on where Drive sync stands. Hidden until
 * sync is set up; becomes a button when a sign-in is all that is missing, so
 * the game can be pushed again without leaving the table.
 */
export function DriveStatusBadge() {
  const folder = useDriveSyncStore((s) => s.folder)
  const status = useDriveSyncStore((s) => s.status)
  const lastSyncAt = useDriveSyncStore((s) => s.lastSyncAt)
  const clientId = useEffectiveClientId()
  const [busy, setBusy] = useState(false)

  if (!folder || !clientId) return null
  const title = `Google Drive · ${folder.name} · ${describeStatus(status, lastSyncAt)}`

  if (status.kind === 'signin') {
    const handleSignIn = async () => {
      setBusy(true)
      try {
        await signIn()
        pushCurrentGame()
      } catch (e) {
        reportSyncError(e)
      } finally {
        setBusy(false)
      }
    }
    return (
      <button
        onClick={handleSignIn}
        disabled={busy}
        title={title}
        className="text-xs text-yellow-500 bg-yellow-500/10 hover:bg-yellow-500/20 px-2 py-1 rounded transition-colors cursor-pointer disabled:opacity-50"
      >
        Drive: sign in
      </button>
    )
  }

  const tone =
    status.kind === 'error'
      ? 'text-red-400 bg-red-500/10'
      : status.kind === 'syncing'
        ? 'text-blue-300 bg-blue-500/10'
        : status.kind === 'ok'
          ? 'text-green-400 bg-green-500/10'
          : 'text-gray-400 bg-gray-800'
  const label =
    status.kind === 'error'
      ? 'Drive ✗'
      : status.kind === 'syncing'
        ? 'Drive…'
        : status.kind === 'ok'
          ? 'Drive ✓'
          : 'Drive'

  return (
    <span title={title} className={`text-xs px-2 py-1 rounded ${tone}`}>
      {label}
    </span>
  )
}
