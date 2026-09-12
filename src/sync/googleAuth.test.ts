import { describe, it, expect } from 'vitest'
import {
  EXPIRY_MARGIN_MS,
  TOKEN_STORAGE_KEY,
  clearStoredToken,
  readStoredToken,
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
