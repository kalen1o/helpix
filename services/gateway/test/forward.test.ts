import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildGateway } from '../src/app'
import { startEcho, testConfig } from './helpers'

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
    expect(call.headers['x-internal-token']).toBe('internal-secret')
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
    expect(h['x-internal-token']).toBe('internal-secret')
    expect(h['x-request-id']).not.toBe('spoofed')
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
