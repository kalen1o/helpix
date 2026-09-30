// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient, type Tokens, type TokenStore } from '../src/api/client'

function memoryStore(initial: Tokens | null): TokenStore & { value: Tokens | null } {
  const store = {
    value: initial,
    get: () => store.value,
    set: (t: Tokens | null) => { store.value = t },
  }
  return store
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Protected routes accept only 'new-access'; refresh accepts only 'r1'. */
function fakeBackend(opts: { refreshOk?: boolean } = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url)
    calls.push({ url: u, init })
    if (u.endsWith('/auth/refresh')) {
      await new Promise((r) => setTimeout(r, 5))
      return opts.refreshOk === false
        ? json(401, { error: { code: 'invalid_refresh_token', message: 'Session expired', requestId: 'r' } })
        : json(200, { accessToken: 'new-access', refreshToken: 'r2', admin: {} })
    }
    const auth = new Headers(init.headers).get('authorization')
    if (auth !== 'Bearer new-access') return json(401, { error: { code: 'invalid_token', message: 'Expired', requestId: 'r' } })
    if (u.endsWith('/empty')) return new Response(null, { status: 204 })
    if (u.endsWith('/conflict')) return json(409, { error: { code: 'slug_taken', message: 'Slug taken', requestId: 'req-9' } })
    return json(200, { path: u })
  })
  return { fetch, calls }
}

describe('createApiClient', () => {
  it('sends the bearer token, JSON body and content-type only when there is a body', async () => {
    const { fetch, calls } = fakeBackend()
    const api = createApiClient({ baseUrl: 'http://gw', tokens: memoryStore({ accessToken: 'new-access', refreshToken: 'r1' }), fetch })
    await api.get('/me')
    await api.post('/admin/tenants', { name: 'x' })
    await api.post('/admin/tenants/1/suspend')
    const [get, post, bare] = calls.map((c) => new Headers(c.init.headers))
    expect(get!.get('authorization')).toBe('Bearer new-access')
    expect(get!.get('content-type')).toBeNull()
    expect(post!.get('content-type')).toBe('application/json')
    expect(calls[1]!.init.body).toBe(JSON.stringify({ name: 'x' }))
    expect(bare!.get('content-type')).toBeNull()
  })

  it('refreshes once on 401 and retries with the new token', async () => {
    const { fetch, calls } = fakeBackend()
    const tokens = memoryStore({ accessToken: 'old-access', refreshToken: 'r1' })
    const api = createApiClient({ baseUrl: 'http://gw', tokens, fetch })
    expect(await api.get('/me')).toEqual({ path: 'http://gw/me' })
    expect(tokens.value).toEqual({ accessToken: 'new-access', refreshToken: 'r2' })
    expect(calls.map((c) => c.url)).toEqual(['http://gw/me', 'http://gw/auth/refresh', 'http://gw/me'])
  })

  it('shares one refresh between concurrent 401s', async () => {
    const { fetch, calls } = fakeBackend()
    const api = createApiClient({ baseUrl: 'http://gw', tokens: memoryStore({ accessToken: 'old-access', refreshToken: 'r1' }), fetch })
    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')])
    expect(results).toHaveLength(3)
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1)
  })

  it('clears the session and reports expiry when refresh fails', async () => {
    const { fetch } = fakeBackend({ refreshOk: false })
    const tokens = memoryStore({ accessToken: 'old-access', refreshToken: 'r1' })
    const onSessionExpired = vi.fn()
    const api = createApiClient({ baseUrl: 'http://gw', tokens, fetch, onSessionExpired })
    await expect(api.get('/me')).rejects.toMatchObject({ status: 401 })
    expect(tokens.value).toBeNull()
    expect(onSessionExpired).toHaveBeenCalledOnce()
  })

  it('does not try to refresh when there is no session (e.g. a failed login)', async () => {
    const { fetch, calls } = fakeBackend()
    const api = createApiClient({ baseUrl: 'http://gw', tokens: memoryStore(null), fetch })
    await expect(api.post('/auth/login', {})).rejects.toBeInstanceOf(ApiError)
    expect(calls).toHaveLength(1)
  })

  it('maps error bodies to ApiError and 204 to undefined', async () => {
    const { fetch } = fakeBackend()
    const api = createApiClient({ baseUrl: 'http://gw', tokens: memoryStore({ accessToken: 'new-access', refreshToken: 'r1' }), fetch })
    await expect(api.get('/conflict')).rejects.toMatchObject({ status: 409, code: 'slug_taken', message: 'Slug taken', requestId: 'req-9' })
    expect(await api.get('/empty')).toBeUndefined()
  })
})
