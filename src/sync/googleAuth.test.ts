import { describe, it, expect, afterEach } from 'vitest'
import {
  EXPIRY_MARGIN_MS,
  RENEW_BEFORE_MS,
  TOKEN_STORAGE_KEY,
  clearStoredToken,
  readAccountHint,
  readStoredToken,
  rememberAccount,
  renewAccessTokenSilently,
  renewalDueAt,
  storeToken,
} from './googleAuth'

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

const NOW = 1_000_000_000_000

/** Let everything already queued run, so a request made behind an await has been made. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('stored access token', () => {
  it('is returned while it is still comfortably valid', () => {
    const s = storage()
    storeToken({ accessToken: 'tok', expiresAt: NOW + 3_600_000, clientId: 'c1' }, s)
    expect(readStoredToken('c1', s, NOW)).toBe('tok')
  })

  it('counts as expired inside the safety margin, not only past expiry', () => {
    const s = storage()
    storeToken({ accessToken: 'tok', expiresAt: NOW + EXPIRY_MARGIN_MS - 1, clientId: 'c1' }, s)
    expect(readStoredToken('c1', s, NOW)).toBeNull()
  })

  it('is ignored for a different client id, or when there is none', () => {
    const s = storage()
    storeToken({ accessToken: 'tok', expiresAt: NOW + 3_600_000, clientId: 'c1' }, s)
    expect(readStoredToken('c2', s, NOW)).toBeNull()
    expect(readStoredToken('', s, NOW)).toBeNull()
  })

  it('survives garbage in storage', () => {
    const s = storage()
    s.setItem(TOKEN_STORAGE_KEY, '{not json')
    expect(readStoredToken('c1', s, NOW)).toBeNull()
    s.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ accessToken: 42 }))
    expect(readStoredToken('c1', s, NOW)).toBeNull()
  })

  it('can be cleared', () => {
    const s = storage()
    storeToken({ accessToken: 'tok', expiresAt: NOW + 3_600_000, clientId: 'c1' }, s)
    clearStoredToken(s)
    expect(readStoredToken('c1', s, NOW)).toBeNull()
  })
})

describe('renewal timing', () => {
  it('falls due a fixed span before the token expires', () => {
    const s = storage()
    storeToken({ accessToken: 'tok', expiresAt: NOW + 3_600_000, clientId: 'c1' }, s)
    expect(renewalDueAt('c1', s, NOW)).toBe(NOW + 3_600_000 - RENEW_BEFORE_MS)
  })

  it('is due at once with nothing stored, or with a token already inside that span', () => {
    const s = storage()
    expect(renewalDueAt('c1', s, NOW)).toBe(NOW)
    storeToken({ accessToken: 'tok', expiresAt: NOW + 1_000, clientId: 'c1' }, s)
    expect(renewalDueAt('c1', s, NOW)).toBe(NOW)
  })
})

describe('the remembered account', () => {
  it('outlives the token it was learnt from, so a renewal can name it', () => {
    const s = storage()
    storeToken({ accessToken: 'tok', expiresAt: NOW + 3_600_000, clientId: 'c1' }, s)
    rememberAccount('c1', 'skipper@example.com', s)
    clearStoredToken(s)
    expect(readAccountHint('c1', s)).toBe('skipper@example.com')
  })

  it('is ignored for another client id', () => {
    const s = storage()
    rememberAccount('c1', 'skipper@example.com', s)
    expect(readAccountHint('c2', s)).toBeUndefined()
  })
})

/** Stand in for the Google script, answering a token request however the test wants. */
interface TokenRequest {
  config: { client_id: string; login_hint?: string; scope: string }
  prompt?: string
  callback: (response: Record<string, unknown>) => void
  errorCallback?: (error: { type: string; message?: string }) => void
}

function fakeGis(): TokenRequest[] {
  const requests: TokenRequest[] = []
  ;(globalThis as Record<string, unknown>).google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: Record<string, unknown>) => ({
          requestAccessToken: (overrides?: { prompt?: string }) => {
            requests.push({
              config: config as TokenRequest['config'],
              prompt: overrides?.prompt,
              callback: config.callback as TokenRequest['callback'],
              errorCallback: config.error_callback as TokenRequest['errorCallback'],
            })
          },
        }),
        revoke: () => {},
      },
    },
  }
  return requests
}

describe('silent renewal', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).google
  })

  it('asks for a token showing nothing, naming the account it knows, and stores what comes back', async () => {
    const requests = fakeGis()
    const s = storage()
    rememberAccount('c1', 'skipper@example.com', s)

    const pending = renewAccessTokenSilently('c1', s)
    await flush()
    expect(requests).toHaveLength(1)
    expect(requests[0].prompt).toBe('none')
    expect(requests[0].config.login_hint).toBe('skipper@example.com')

    requests[0].callback({ access_token: 'fresh', expires_in: 3600 })
    expect(await pending).toBe('fresh')
    expect(readStoredToken('c1', s)).toBe('fresh')
  })

  it('resolves with nothing rather than throwing when Google will not renew unattended', async () => {
    const requests = fakeGis()
    const s = storage()
    rememberAccount('c1', 'skipper@example.com', s)

    const pending = renewAccessTokenSilently('c1', s)
    await flush()
    requests[0].callback({ error: 'interaction_required' })
    expect(await pending).toBeNull()
  })

  it('makes one request for callers that overlap', async () => {
    const requests = fakeGis()
    const s = storage()
    rememberAccount('c1', 'skipper@example.com', s)

    const first = renewAccessTokenSilently('c1', s)
    const second = renewAccessTokenSilently('c1', s)
    await flush()
    expect(requests).toHaveLength(1)

    requests[0].callback({ access_token: 'fresh', expires_in: 3600 })
    expect(await first).toBe('fresh')
    expect(await second).toBe('fresh')
  })
})

