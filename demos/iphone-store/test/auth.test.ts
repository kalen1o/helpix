import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AuthModule = typeof import('../src/auth')
let a: AuthModule

const MAYA = { id: 'cust_maya', name: 'Maya Chen', email: 'maya@orchard.demo' }
const reply = (status: number, body?: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

function fakeHelpix() {
  const h = { open: vi.fn(), close: vi.fn(), identify: vi.fn(), logout: vi.fn() }
  window.Helpix = h
  return h
}

function backend(routes: Record<string, () => Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    const route = routes[key]
    if (!route) throw new Error(`unexpected ${key}`)
    return route()
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(async () => {
  // auth.ts keeps module state (token, poll timer): give every test a fresh copy.
  vi.resetModules()
  localStorage.clear()
  delete window.Helpix
  a = await import('../src/auth')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('refresh', () => {
  it('identifies a signed-in shopper to the widget with the fresh token', async () => {
    const h = fakeHelpix()
    backend({ 'GET /api/me': () => reply(200, { customer: MAYA, helpixToken: 'jwt-maya' }) })
    await a.refresh()
    expect(a.auth.customer).toEqual(MAYA)
    expect(a.auth.loaded).toBe(true)
    expect(h.identify).toHaveBeenCalledWith('jwt-maya')
    expect(h.logout).not.toHaveBeenCalled()
  })

  it('waits for a widget script that runs after the app', async () => {
    vi.useFakeTimers()
    backend({ 'GET /api/me': () => reply(200, { customer: MAYA, helpixToken: 'jwt-maya' }) })
    await a.refresh()
    const h = fakeHelpix()
    expect(h.identify).not.toHaveBeenCalled()
    vi.advanceTimersByTime(150)
    expect(h.identify).toHaveBeenCalledWith('jwt-maya')
    vi.advanceTimersByTime(5000)
    expect(h.identify).toHaveBeenCalledTimes(1)
  })

  it('never logs out an anonymous visitor, so their conversation survives page loads', async () => {
    const h = fakeHelpix()
    backend({ 'GET /api/me': () => reply(200, { customer: null }) })
    await a.refresh()
    expect(h.identify).not.toHaveBeenCalled()
    expect(h.logout).not.toHaveBeenCalled()
  })

  it('logs the widget out when the shopper this browser identified is no longer signed in', async () => {
    const h = fakeHelpix()
    backend({ 'GET /api/me': () => reply(200, { customer: MAYA, helpixToken: 'jwt-maya' }) })
    await a.refresh()
    backend({ 'GET /api/me': () => reply(200, { customer: null }) })
    await a.refresh()
    expect(h.logout).toHaveBeenCalledTimes(1)
    await a.refresh()
    expect(h.logout).toHaveBeenCalledTimes(1)
  })

  it('logs out a second tab whose shared storage key was already removed by the first', async () => {
    const h = fakeHelpix()
    backend({ 'GET /api/me': () => reply(200, { customer: MAYA, helpixToken: 'jwt-maya' }) })
    await a.refresh()
    localStorage.removeItem('orchard:helpix-customer')
    backend({ 'GET /api/me': () => reply(200, { customer: null }) })
    await a.refresh()
    expect(h.logout).toHaveBeenCalledTimes(1)
  })

  it('keeps the current state when the backend is down', async () => {
    fakeHelpix()
    backend({ 'GET /api/me': () => reply(200, { customer: MAYA, helpixToken: 'jwt-maya' }) })
    await a.refresh()
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await a.refresh()
    expect(a.auth.customer).toEqual(MAYA)
  })
})

describe('sign in, sign up, sign out', () => {
  it('signIn posts the credentials, then identifies the shopper', async () => {
    const h = fakeHelpix()
    const fetchMock = backend({
      'POST /api/login': () => reply(200, { customer: MAYA }),
      'GET /api/me': () => reply(200, { customer: MAYA, helpixToken: 'jwt-maya' }),
    })
    await a.signIn('maya@orchard.demo', 'orchard-demo')
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ email: 'maya@orchard.demo', password: 'orchard-demo' })
    expect(h.identify).toHaveBeenCalledWith('jwt-maya')
  })

  it('signIn surfaces the server message', async () => {
    backend({ 'POST /api/login': () => reply(401, { error: { code: 'invalid_credentials', message: 'Email or password is incorrect' } }) })
    await expect(a.signIn('maya@orchard.demo', 'nope')).rejects.toMatchObject({
      name: 'ShopApiError',
      code: 'invalid_credentials',
      message: 'Email or password is incorrect',
    })
    expect(a.auth.customer).toBeNull()
  })

  it('signUp passes the field of a validation error through', async () => {
    backend({ 'POST /api/signup': () => reply(409, { error: { code: 'email_taken', message: 'An account with that email already exists.', field: 'email' } }) })
    await expect(a.signUp('Maya', 'maya@orchard.demo', 'long-enough')).rejects.toMatchObject({ code: 'email_taken', field: 'email' })
  })

  it('signOut posts /api/logout and logs the widget out', async () => {
    const h = fakeHelpix()
    const fetchMock = backend({
      'GET /api/me': () => reply(200, { customer: MAYA, helpixToken: 'jwt-maya' }),
      'POST /api/logout': () => reply(204),
    })
    await a.refresh()
    await a.signOut()
    expect(fetchMock).toHaveBeenCalledWith('/api/logout', expect.objectContaining({ method: 'POST' }))
    expect(a.auth.customer).toBeNull()
    expect(h.logout).toHaveBeenCalledTimes(1)
  })
})

describe('sign out with blocked storage', () => {
  it('still logs the widget out', async () => {
    const h = fakeHelpix()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    backend({ 'POST /api/logout': () => reply(204) })
    await a.signOut()
    expect(h.logout).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })
})

describe('startAuth', () => {
  it('refreshes now, on window focus and every 30 minutes', async () => {
    vi.useFakeTimers()
    fakeHelpix()
    const fetchMock = backend({ 'GET /api/me': () => reply(200, { customer: MAYA, helpixToken: 'jwt-maya' }) })
    const stop = a.startAuth()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('focus'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(a.REFRESH_MS)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    stop()
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(a.REFRESH_MS)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('nextPath', () => {
  it('only allows same-site paths', () => {
    expect(a.nextPath('/bag')).toBe('/bag')
    expect(a.nextPath('//evil.test/x')).toBe('/')
    expect(a.nextPath('/\\evil.test')).toBe('/')
    expect(a.nextPath('https://evil.test')).toBe('/')
    expect(a.nextPath(undefined)).toBe('/')
  })
})
