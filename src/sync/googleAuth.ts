/**
 * Signing the user in to Google Drive from a page with no server behind it.
 *
 * Google Identity Services (GIS) hands a browser app an access token straight
 * from a popup: the app needs only an OAuth client ID, never a secret. The
 * token lives about an hour and there is no refresh token in this flow, so the
 * app keeps the last one in local storage and uses it while it lasts.
 *
 * What keeps the user from signing in every hour is the *silent* renewal: with
 * `prompt: 'none'` GIS asks Google for another token without showing anything,
 * and Google grants it as long as the browser still has a live Google session
 * and the app's consent is on record. That costs the user nothing, so the app
 * renews a few minutes before expiry rather than waiting to be refused, and
 * again whenever the tab comes back to the front.
 *
 * A silent renewal can still fail — signed out of Google, consent withdrawn, or
 * the browser refusing to open the flow away from a click. The first two need
 * the user, so the app falls back to the "sign in" control. For the third it
 * simply tries again on the next tap: inside a gesture nothing is blocked, and
 * a silent renewal shows no window, so the user sees only that sync carried on.
 */

/**
 * Full Drive access rather than the narrower per-file scope: the user picks
 * any folder of theirs to sync into, which means listing folders they made
 * elsewhere, and that is beyond what the per-file scope can see.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
export const TOKEN_STORAGE_KEY = 'wargame-ai-drive-token'
/**
 * Which Google account the tokens have been for. Kept apart from the token so
 * it outlives it: an expired token is forgotten, but knowing whose it was lets
 * the next renewal name the account and skip the chooser.
 */
export const ACCOUNT_STORAGE_KEY = 'wargame-ai-drive-account'
/** A token this close to expiry is treated as already expired, so a sync begun with it does not die halfway through. */
export const EXPIRY_MARGIN_MS = 60_000
/** How long before expiry the background renewal fires. Comfortably more than the margin, so it renews before anything is refused. */
export const RENEW_BEFORE_MS = 5 * 60_000
/** After a silent renewal fails, the soonest the timer tries again. A tap or the tab regaining focus may try sooner. */
export const RENEW_RETRY_MS = 60_000
/** A silent renewal that has neither succeeded nor failed by now is taken as failed; GIS reports a blocked flow by simply never calling back. */
const SILENT_TIMEOUT_MS = 12_000

export interface StoredToken {
  accessToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  /** The client the token was issued to; a token for another client is useless. */
  clientId: string
}

const defaultStorage = (): Storage | null =>
  typeof localStorage === 'undefined' ? null : localStorage

/** The stored token as it was written, expiry not considered. */
function readTokenRecord(clientId: string, storage: Storage | null): StoredToken | null {
  if (!storage || !clientId) return null
  const raw = storage.getItem(TOKEN_STORAGE_KEY)
  if (!raw) return null
  try {
    const token = JSON.parse(raw) as Partial<StoredToken>
    if (typeof token.accessToken !== 'string' || typeof token.expiresAt !== 'number') return null
    if (token.clientId !== clientId) return null
    return token as StoredToken
  } catch {
    return null
  }
}

export function readStoredToken(
  clientId: string,
  storage: Storage | null = defaultStorage(),
  now: number = Date.now(),
): string | null {
  const token = readTokenRecord(clientId, storage)
  if (!token) return null
  return token.expiresAt - EXPIRY_MARGIN_MS <= now ? null : token.accessToken
}

/** When the token in hand should be renewed, or `now` when there is nothing usable left. */
export function renewalDueAt(
  clientId: string,
  storage: Storage | null = defaultStorage(),
  now: number = Date.now(),
): number {
  const token = readTokenRecord(clientId, storage)
  if (!token) return now
  return Math.max(now, token.expiresAt - RENEW_BEFORE_MS)
}

export function storeToken(token: StoredToken, storage: Storage | null = defaultStorage()): void {
  storage?.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token))
}

export function clearStoredToken(storage: Storage | null = defaultStorage()): void {
  storage?.removeItem(TOKEN_STORAGE_KEY)
}

interface StoredAccount {
  clientId: string
  email: string
}

/** Remember whose account this is, so later renewals can go straight to it. */
export function rememberAccount(
  clientId: string,
  email: string,
  storage: Storage | null = defaultStorage(),
): void {
  if (!clientId || !email) return
  storage?.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({ clientId, email } satisfies StoredAccount))
}

export function readAccountHint(
  clientId: string,
  storage: Storage | null = defaultStorage(),
): string | undefined {
  if (!storage || !clientId) return undefined
  const raw = storage.getItem(ACCOUNT_STORAGE_KEY)
  if (!raw) return undefined
  try {
    const account = JSON.parse(raw) as Partial<StoredAccount>
    return account.clientId === clientId && typeof account.email === 'string'
      ? account.email
      : undefined
  } catch {
    return undefined
  }
}

export function forgetAccount(storage: Storage | null = defaultStorage()): void {
  storage?.removeItem(ACCOUNT_STORAGE_KEY)
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
 * Ask GIS for a token and store it. `prompt` decides how much the user may be
 * shown: `'none'` nothing at all, `''` the account chooser only if the app has
 * not been consented to yet.
 */
async function requestToken(
  clientId: string,
  prompt: '' | 'none',
  storage: Storage | null,
): Promise<string> {
  await preloadGoogleIdentity()
  const oauth2 = gis()?.accounts?.oauth2
  if (!oauth2) throw new Error('Google sign-in did not initialise')

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      run()
    }
    // A silent request that is blocked before it starts never calls back at
    // all, so it needs a deadline of its own or the renewal would hang.
    const timer = setTimeout(
      () => finish(() => reject(new Error('Google sign-in did not answer'))),
      SILENT_TIMEOUT_MS,
    )

    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      login_hint: readAccountHint(clientId, storage),
      callback: (response) => {
        finish(() => {
          if (response.error || !response.access_token) {
            reject(
              new Error(response.error_description ?? response.error ?? 'Google sign-in failed'),
            )
            return
          }
          const expiresIn = Number(response.expires_in ?? 3600)
          storeToken(
            {
              accessToken: response.access_token,
              expiresAt: Date.now() + expiresIn * 1000,
              clientId,
            },
            storage,
          )
          resolve(response.access_token)
        })
      },
      error_callback: (error) => {
        finish(() => {
          const message =
            error.type === 'popup_closed'
              ? 'Google sign-in was cancelled'
              : error.type === 'popup_failed_to_open'
                ? 'The browser blocked the Google sign-in window'
                : (error.message ?? 'Google sign-in failed')
          reject(new Error(message))
        })
      },
    })
    client.requestAccessToken({ prompt })
  })
}

/**
 * Open the Google sign-in popup and resolve with a fresh access token. Must be
 * called from a user gesture, or the browser is likely to block the popup.
 *
 * An empty prompt lets Google skip the account chooser and consent screen when
 * the user has already granted this app access.
 */
export async function requestAccessToken(
  clientId: string,
  storage: Storage | null = defaultStorage(),
): Promise<string> {
  const token = await requestToken(clientId, '', storage)
  void noteAccount(clientId, token, storage)
  return token
}

let silentRenewal: Promise<string | null> | null = null

/**
 * Renew the token without showing the user anything, resolving null if Google
 * will not do it silently. Concurrent callers share the one attempt.
 */
export function renewAccessTokenSilently(
  clientId: string,
  storage: Storage | null = defaultStorage(),
): Promise<string | null> {
  if (!clientId) return Promise.resolve(null)
  silentRenewal ??= requestToken(clientId, 'none', storage)
    .then((token) => {
      void noteAccount(clientId, token, storage)
      return token
    })
    .catch(() => null)
    .finally(() => {
      silentRenewal = null
    })
  return silentRenewal
}

/**
 * Which account a token belongs to, asked of Drive itself — the app already
 * has the scope for it, where reading the user's profile would need another.
 * Only worth a call when the account is not already known.
 */
async function noteAccount(
  clientId: string,
  accessToken: string,
  storage: Storage | null,
): Promise<void> {
  if (readAccountHint(clientId, storage)) return
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!res.ok) return
    const body = (await res.json()) as { user?: { emailAddress?: string } }
    if (body.user?.emailAddress) rememberAccount(clientId, body.user.emailAddress, storage)
  } catch {
    // A hint is a convenience; without it the renewal simply has to guess the account.
  }
}

/**
 * The current access token: the stored one while it is still good, then a
 * silent renewal, and only then the popup when `interactive`. Null otherwise,
 * which callers turn into a "sign in" prompt.
 */
export async function getAccessToken(
  clientId: string,
  { interactive }: { interactive: boolean },
): Promise<string | null> {
  const cached = readStoredToken(clientId)
  if (cached) return cached
  const renewed = await renewAccessTokenSilently(clientId)
  if (renewed) return renewed
  if (!interactive) return null
  return requestAccessToken(clientId)
}

/**
 * Keep a token in hand for as long as the page is open: renew a few minutes
 * before expiry, and try again whenever the tab is brought back, the network
 * returns, or the user taps — the last because a browser that refuses the
 * silent flow in the background allows it inside a gesture.
 *
 * `onChange` hears every attempt's outcome, so the caller can clear or raise a
 * "sign in" prompt and resume whatever the lapsed token interrupted.
 */
export function startTokenRenewal(
  clientId: string,
  onChange: (token: string | null) => void = () => {},
): () => void {
  if (typeof window === 'undefined') return () => {}
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let gestureArmed = false

  const onGesture = () => {
    gestureArmed = false
    window.removeEventListener('pointerdown', onGesture)
    void attempt()
  }
  const armGesture = () => {
    if (gestureArmed || stopped) return
    gestureArmed = true
    window.addEventListener('pointerdown', onGesture, { once: true })
  }
  const schedule = (delay: number) => {
    clearTimeout(timer)
    if (!stopped) timer = setTimeout(() => void attempt(), Math.max(0, delay))
  }

  const attempt = async (): Promise<void> => {
    if (stopped) return
    const due = renewalDueAt(clientId) - Date.now()
    if (due > 0) {
      schedule(due)
      return
    }
    const token = await renewAccessTokenSilently(clientId)
    if (stopped) return
    onChange(token)
    if (token) {
      schedule(renewalDueAt(clientId) - Date.now())
    } else {
      // Nothing more to try on a clock alone; a tap or a return to the tab is
      // the likelier way back, with the timer only as a long stop.
      armGesture()
      schedule(RENEW_RETRY_MS)
    }
  }

  const onVisible = () => {
    if (!document.hidden) void attempt()
  }
  const onOnline = () => void attempt()
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  void attempt()

  return () => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
    if (gestureArmed) window.removeEventListener('pointerdown', onGesture)
  }
}

/** Forget the stored token and, if GIS is loaded, tell Google it is no longer wanted. */
export function revokeToken(storage: Storage | null = defaultStorage()): void {
  const raw = storage?.getItem(TOKEN_STORAGE_KEY)
  clearStoredToken(storage)
  forgetAccount(storage)
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
