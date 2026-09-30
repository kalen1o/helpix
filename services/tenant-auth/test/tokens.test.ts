import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTokenService, hashToken, newRefreshToken, newWidgetKey } from '../src/lib/tokens'

const SECRET = 'test-secret-test-secret-test-secret-1234'
const claims = { adminId: 'a1', role: 'tenant_admin' as const, tenantId: 't1' }

afterEach(() => vi.useRealTimers())

describe('access tokens', () => {
  it('round-trips claims', async () => {
    const svc = createTokenService(SECRET, '15m')
    expect(await svc.verifyAccess(await svc.signAccess(claims))).toEqual(claims)
  })

  it('keeps a null tenant for super-admins', async () => {
    const svc = createTokenService(SECRET, '15m')
    const c = { adminId: 'a0', role: 'super_admin' as const, tenantId: null }
    expect(await svc.verifyAccess(await svc.signAccess(c))).toEqual(c)
  })

  it('rejects a tampered token', async () => {
    const svc = createTokenService(SECRET, '15m')
    const token = await svc.signAccess(claims)
    const [h, , s] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: 'a1', role: 'super_admin', tid: null })).toString('base64url')
    expect(await svc.verifyAccess(`${h}.${forged}.${s}`)).toBeNull()
  })

  it('rejects a token signed with another secret', async () => {
    const other = createTokenService('another-secret-another-secret-12345678', '15m')
    expect(await createTokenService(SECRET, '15m').verifyAccess(await other.signAccess(claims))).toBeNull()
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const svc = createTokenService(SECRET, '1m')
    const token = await svc.signAccess(claims)
    vi.setSystemTime(new Date('2026-01-01T00:02:00Z'))
    expect(await svc.verifyAccess(token)).toBeNull()
  })

  it('returns null for garbage', async () => {
    expect(await createTokenService(SECRET, '15m').verifyAccess('not-a-jwt')).toBeNull()
  })
})

describe('random credentials', () => {
  it('refresh tokens are unique and hash deterministically', () => {
    const a = newRefreshToken()
    const b = newRefreshToken()
    expect(a.token).not.toBe(b.token)
    expect(hashToken(a.token)).toBe(a.hash)
    expect(a.hash).not.toContain(a.token)
  })

  it('widget keys have the wk_ prefix and are unique', () => {
    const k = newWidgetKey()
    expect(k).toMatch(/^wk_[A-Za-z0-9_-]{32}$/)
    expect(newWidgetKey()).not.toBe(k)
  })
})
