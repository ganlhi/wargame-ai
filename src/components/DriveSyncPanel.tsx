import { useState } from 'react'
import { describeStatus, useDriveSyncStore, useEffectiveClientId } from '../sync/syncStore'
import { disconnect, pullFromDrive, reportSyncError, signIn } from '../sync/syncActions'
import { DriveSyncModal } from './DriveSyncModal'

const button =
  'text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
const primary = `${button} border-blue-600 bg-blue-600 hover:bg-blue-500 text-white`
const secondary = `${button} border-gray-700 text-gray-300 hover:text-white hover:border-gray-500`
const danger = `${button} border-red-900 text-red-400 hover:text-red-300`

/** The Drive sync card on the main menu: status at a glance, and the controls to set it up, refresh, or drop it. */
export function DriveSyncPanel() {
  const { folder, status, lastSyncAt } = useDriveSyncStore()
  const clientId = useEffectiveClientId()
  const [open, setOpen] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const configured = !!folder && !!clientId
  const busy = status.kind === 'syncing'

  const handleSignIn = async () => {
    try {
      await signIn()
      await pullFromDrive()
    } catch (e) {
      reportSyncError(e)
    }
  }

  const dot = !configured
    ? 'bg-gray-600'
    : status.kind === 'error'
      ? 'bg-red-500'
      : status.kind === 'signin' || status.kind === 'syncing'
        ? 'bg-yellow-400'
        : 'bg-green-500'

  return (
    <section className="mb-6 p-4 border border-gray-800 rounded-xl bg-gray-900">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${dot}`} aria-hidden="true" />
            Google Drive sync
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            {configured ? (
              <>
                Folder <span className="text-gray-300">{folder.name}</span> ·{' '}
                <span className={status.kind === 'error' ? 'text-red-400' : undefined}>
                  {describeStatus(status, lastSyncAt)}
                </span>
              </>
            ) : (
              'Keep your games in a Google Drive folder and pick them up on any device.'
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {configured && status.kind === 'signin' && (
            <button className={primary} onClick={handleSignIn}>
              Sign in
            </button>
          )}
          {configured && status.kind !== 'signin' && (
            <button className={secondary} disabled={busy} onClick={() => void pullFromDrive()} title="Replace the games on this device with those on Drive">
              Load from Drive
            </button>
          )}
          <button className={secondary} disabled={busy} onClick={() => setOpen(true)}>
            {configured ? 'Change folder' : 'Set up'}
          </button>
          {configured &&
            (confirmDisconnect ? (
              <>
                <button
                  className={danger}
                  onClick={() => {
                    disconnect()
                    setConfirmDisconnect(false)
                  }}
                >
                  Confirm disconnect
                </button>
                <button className={secondary} onClick={() => setConfirmDisconnect(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className={secondary} onClick={() => setConfirmDisconnect(true)} title="Stop syncing. Nothing is deleted here or on Drive.">
                Disconnect
              </button>
            ))}
        </div>
      </div>
      {open && <DriveSyncModal onClose={() => setOpen(false)} />}
    </section>
  )
}
