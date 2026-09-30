import net, { type AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedAdmin } from '@helpix/shared/api-types'
import { buildGateway } from '../src/app'
import { rawRequest, startEcho, TEST_INTERNAL_TOKEN, testConfig } from './helpers'

let echo: Awaited<ReturnType<typeof startEcho>>
let gw: FastifyInstance

beforeEach(async () => {
  echo = await startEcho()
  gw = await buildGateway({ config: testConfig(echo.url) })
})
afterEach(async () => {
  await gw.close()
  await echo.close()
})

describe('gateway forwarding', () => {
  it('answers /health with a request id', async () => {
    const res = await gw.inject({ method: 'GET', url: '/health' })
    expect(res.json()).toEqual({ ok: true })
    expect(res.headers['x-request-id']).toEqual(expect.any(String))
  })

  it('forwards /auth/* with body, query, internal token and the same request id', async () => {
    const res = await gw.inject({
      method: 'POST',
      url: '/auth/login?x=1',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@b.co', password: 'pw' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-upstream']).toBe('yes')
    const call = echo.calls[0]!
    expect(call.url).toBe('/auth/login?x=1')
    expect(JSON.parse(call.body!)).toEqual({ email: 'a@b.co', password: 'pw' })
    expect(call.headers['x-internal-token']).toBe(TEST_INTERNAL_TOKEN)
    expect(call.headers['x-request-id']).toBe(res.headers['x-request-id'])
  })

  it('strips client-supplied identity headers, authorization and request id', async () => {
    await gw.inject({
      method: 'POST',
      url: '/auth/login',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 'spoofed',
        'x-customer-id': 'spoofed',
        'x-helpix-role': 'super_admin',
        'x-admin-id': 'spoofed',
        'x-internal-token': 'spoofed',
        'x-request-id': 'spoofed',
        authorization: 'Bearer spoofed',
      },
      payload: '{}',
    })
    const h = echo.calls[0]!.headers
    expect(h['x-tenant-id']).toBeUndefined()
    expect(h['x-customer-id']).toBeUndefined()
    expect(h['x-helpix-role']).toBeUndefined()
    expect(h['x-admin-id']).toBeUndefined()
    expect(h.authorization).toBeUndefined()
    expect(h['x-internal-token']).toBe(TEST_INTERNAL_TOKEN)
    expect(h['x-request-id']).not.toBe('spoofed')
  })

  it('strips a client-supplied x-internal-caller header', async () => {
    await gw.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json', 'x-internal-caller': 'resolver' },
      payload: '{}',
    })
    expect(echo.calls[0]!.headers['x-internal-caller']).toBeUndefined()
  })

  it('rejects bodies over the limit with 413 without calling upstream', async () => {
    const res = await gw.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ big: 'x'.repeat(2000) }),
    })
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('payload_too_large')
    expect(echo.calls).toHaveLength(0)
  })

  it('does not expose internal routes', async () => {
    const res = await gw.inject({ method: 'POST', url: '/internal/resolve-admin', payload: {} })
    expect(res.statusCode).toBe(404)
    expect(echo.calls).toHaveLength(0)
  })

  it('returns 502 when the upstream is down', async () => {
    const down = await buildGateway({ config: testConfig('http://127.0.0.1:1') })
    const res = await down.inject({ method: 'POST', url: '/auth/login', headers: { 'content-type': 'application/json' }, payload: '{}' })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe('upstream_unavailable')
    await down.close()
  })
})

describe('gateway path canonicalization (raw request line)', () => {
  let g: FastifyInstance
  let port: number
  const resolveAdmin = vi.fn(async (): Promise<ResolvedAdmin> => ({ adminId: 'admin-super', role: 'super_admin', tenantId: null }))

  beforeEach(async () => {
    resolveAdmin.mockClear()
    g = await buildGateway({ config: testConfig(echo.url), tenantAuth: { resolveAdmin } })
    await g.listen({ port: 0, host: '127.0.0.1' })
    port = (g.server.address() as AddressInfo).port
  })
  afterEach(async () => {
    await g.close()
  })

  const post = (path: string, headers: Record<string, string> = {}) =>
    rawRequest(port, { method: 'POST', path, headers: { 'content-type': 'application/json', ...headers }, body: '{"accessToken":"x"}' })

  it.each([
    '/auth/../internal/resolve-admin',
    '/auth/%2e%2e/internal/resolve-admin',
    '/auth/.%2E/internal/resolve-widget',
    '/auth/%2E%2E/internal/resolve-widget',
    '/auth/%2e%2e/admin/tenants',
    '/auth/..%2finternal/x',
    '/auth/..%2Finternal/x',
    '/auth/%5c..%5cinternal/x',
    '/auth/%5C..%5Cinternal/x',
    '/auth/\\..\\internal/x',
    '/auth/./login',
    '/auth/%2e/login',
    '/auth/login/..',
    '/auth/x/../../internal/resolve-admin?y=1',
    '/auth/%2e%2e',
  ])('rejects %s with 404 not_found without calling upstream', async (path) => {
    const res = await post(path)
    expect(res.status).toBe(404)
    expect(res.json.error).toMatchObject({ code: 'not_found', requestId: expect.any(String) })
    expect(echo.calls).toHaveLength(0)
  })

  it.each([
    '/admin/%2e%2e/internal/resolve-admin',
    '/admin/../internal/resolve-admin',
    '/admin/tenants/%2E%2E/%2e%2e/internal/resolve-widget',
  ])('rejects %s with a valid bearer before resolving identity or calling upstream', async (path) => {
    const res = await post(path, { authorization: 'Bearer super-token' })
    expect(res.status).toBe(404)
    expect(res.json.error.code).toBe('not_found')
    expect(echo.calls).toHaveLength(0)
    expect(resolveAdmin).not.toHaveBeenCalled()
  })

  it('forwards a normal path with a query string unchanged', async () => {
    const res = await post('/auth/login?x=1&next=%2Fadmin%2F..%2Finternal')
    expect(res.status).toBe(200)
    expect(echo.calls).toHaveLength(1)
    expect(echo.calls[0]!.url).toBe('/auth/login?x=1&next=%2Fadmin%2F..%2Finternal')
  })

  it('forwards /me and /admin/* with a valid bearer unchanged', async () => {
    await rawRequest(port, { method: 'GET', path: '/me', headers: { authorization: 'Bearer super-token' } })
    await rawRequest(port, { method: 'GET', path: '/admin/tenants/abc/admins?page=2', headers: { authorization: 'Bearer super-token' } })
    expect(echo.calls.map((c) => c.url)).toEqual(['/me', '/admin/tenants/abc/admins?page=2'])
  })

  it('forwards a double-encoded dot segment verbatim, so the upstream never sees a dot segment', async () => {
    const res = await post('/auth/%252e%252e/internal/resolve-admin')
    expect(res.status).toBe(200)
    expect(echo.calls[0]!.url).toBe('/auth/%252e%252e/internal/resolve-admin')
  })
})

describe('gateway body streaming', () => {
  it('streams a multi-chunk body under the limit through intact', async () => {
    const big = JSON.stringify({ data: 'y'.repeat(300_000) })
    const g = await buildGateway({ config: { ...testConfig(echo.url), bodyLimitBytes: 1_000_000 } })
    const res = await g.inject({ method: 'POST', url: '/auth/login', headers: { 'content-type': 'application/json' }, payload: big })
    expect(res.statusCode).toBe(200)
    expect(echo.calls[0]!.body).toBe(big)
    await g.close()
  })

  it('closes the upstream connection when the client aborts mid-upload', async () => {
    let upstreamClosed!: () => void
    const closed = new Promise<void>((r) => (upstreamClosed = r))
    const sink = net.createServer((sock) => {
      sock.on('error', () => {})
      sock.resume()
      sock.on('close', upstreamClosed)
    })
    await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r))
    const sinkPort = (sink.address() as AddressInfo).port
    const g = await buildGateway({ config: testConfig(`http://127.0.0.1:${sinkPort}`) })
    await g.listen({ port: 0, host: '127.0.0.1' })
    const gwPort = (g.server.address() as AddressInfo).port
    const client = net.connect(gwPort, '127.0.0.1')
    client.on('error', () => {})
    await new Promise<void>((r) => client.once('connect', () => r()))
    client.write('POST /auth/login HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 500\r\n\r\n{"partial":')
    await new Promise((r) => setTimeout(r, 100))
    client.destroy()
    await Promise.race([
      closed,
      new Promise((_, rej) => setTimeout(() => rej(new Error('upstream connection was not closed')), 3000)),
    ])
    await g.close()
    await new Promise((r) => sink.close(r))
  })
})
