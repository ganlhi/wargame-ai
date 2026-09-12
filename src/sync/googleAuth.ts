/**
 * Signing the user in to Google Drive from a page with no server behind it.
 *
 * Google Identity Services (GIS) hands a browser app an access token straight
 * from a popup: the app needs only an OAuth client ID, never a secret. The
 * token lives about an hour and there is no refresh token in this flow, so
 * once it lapses the user has to click through the popup again — which the
 * browser only allows in response to a click. The app therefore keeps the last
 * token in local storage, uses it silently while it lasts, and otherwise shows
 * a "sign in" control rather than trying to open a popup on its own.
 */

/**
 * Full Drive access rather than the narrower per-file scope: the user picks
 * any folder of theirs to sync into, which means listing folders they made
 * elsewhere, and that is beyond what the per-file scope can see.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
export const TOKEN_STORAGE_KEY = 'wargame-ai-drive-token'
/** A token this close to expiry is treated as already expired, so a sync begun with it does not die halfway through. */
export const EXPIRY_MARGIN_MS = 60_000

export interface StoredToken {
  accessToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  /** The client the token was issued to; a token for another client is useless. */
  clientId: string
}

const defaultStorage = (): Storage | null =>
  typeof localStorage === 'undefined' ? null : localStorage

export function readStoredToken(
  clientId: string,
  storage: Storage | null = defaultStorage(),
  now: number = Date.now(),
): string | null {
  if (!storage || !clientId) return null
  const raw = storage.getItem(TOKEN_STORAGE_KEY)
  if (!raw) return null
  try {
    const token = JSON.parse(raw) as Partial<StoredToken>
    if (typeof token.accessToken !== 'string' || typeof token.expiresAt !== 'number') return null
    if (token.clientId !== clientId) return null
    if (token.expiresAt - EXPIRY_MARGIN_MS <= now) return null
    return token.accessToken
  } catch {
    return null
  }
}

export function storeToken(token: StoredToken, storage: Storage | null = defaultStorage()): void {
  storage?.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token))
}

export function clearStoredToken(storage: Storage | null = defaultStorage()): void {
  storage?.removeItem(TOKEN_STORAGE_KEY)
}

export const hasValidToken = (clientId: string): boolean => readStoredToken(clientId) !== null

type Gis = typeof google
const gis = (): Gis | undefined => (globalThis as { google?: Gis }).google

let gisLoading: Promise<void> | null = null

/** Load the GIS script once. Safe to call early so the sign-in popup opens promptly on the click that needs it. */
export function preloadGoogleIdentity(): Promise<void> {
  if (gis()?.accounts?.oauth2) return Promise.resolve()
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = GIS_SRC
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => {
        gisLoading = null
        reject(new Error('Could not load Google sign-in. Check your connection.'))
      }
      document.head.appendChild(script)
    })
  }
  return gisLoading
}

/**
 * Open the Google sign-in popup and resolve with a fresh access token. Must be
 * called from a user gesture, or the browser is likely to block the popup.
 */
export async function requestAccessToken(
  clientId: string,
  storage: Storage | null = defaultStorage(),
): Promise<string> {
  await preloadGoogleIdentity()
  const oauth2 = gis()?.accounts?.oauth2
  if (!oauth2) throw new Error('Google sign-in did not initialise')

  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description ?? response.error ?? 'Google sign-in failed'))
          return
        }
        const expiresIn = Number(response.expires_in ?? 3600)
        storeToken(
          { accessToken: response.access_token, expiresAt: Date.now() + expiresIn * 1000, clientId },
          storage,
        )
        resolve(response.access_token)
      },
      error_callback: (error) => {
        const message =
          error.type === 'popup_closed'
            ? 'Google sign-in was cancelled'
            : error.type === 'popup_failed_to_open'
              ? 'The browser blocked the Google sign-in window'
              : (error.message ?? 'Google sign-in failed')
        reject(new Error(message))
      },
    })
    // An empty prompt lets Google skip the account chooser and consent screen
    // when the user has already granted this app access.
    client.requestAccessToken({ prompt: '' })
  })
}

/**
 * The current access token: the stored one while it is still good, otherwise a
 * new one from the popup when `interactive` — and null when not, which callers
 * turn into a "sign in" prompt.
 */
export async function getAccessToken(
  clientId: string,
  { interactive }: { interactive: boolean },
): Promise<string | null> {
  const cached = readStoredToken(clientId)
  if (cached) return cached
  if (!interactive) return null
  return requestAccessToken(clientId)
}

/** Forget the stored token and, if GIS is loaded, tell Google it is no longer wanted. */
export function revokeToken(storage: Storage | null = defaultStorage()): void {
  const raw = storage?.getItem(TOKEN_STORAGE_KEY)
  clearStoredToken(storage)
  if (!raw) return
  try {
    const token = JSON.parse(raw) as Partial<StoredToken>
    if (typeof token.accessToken === 'string') {
      gis()?.accounts?.oauth2?.revoke(token.accessToken, () => {})
    }
  } catch {
    // Nothing usable to revoke.
  }
}
