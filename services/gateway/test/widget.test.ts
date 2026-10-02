import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@helpix/shared'
import { buildGateway } from '../src/app'
import { createWidgetIdentity } from '../src/widget'
import type { TenantAuthClient } from '../src/tenantAuthClient'
import { startEcho, testConfig } from './helpers'

const SHOP = 'https://shop.example'
const KEY = 'wk_live_a'

const b64url = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url')
/** A JWT-shaped token. The gateway never verifies signatures (tenant-auth does), so the signature is junk. */
const fakeJwt = (claims: Record<string, unknown>) => `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(claims)}.c2ln`
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600
const subOf = (token: string): string | null => {
  try {
    const sub = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')).sub
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}

function fakeTenantAuth(): TenantAuthClient & { resolveWidget: ReturnType<typeof vi.fn> } {
  return {
    resolveAdmin: vi.fn(async (token: string) => {
      if (token !== 'tenant-token') throw new AppError(401, 'invalid_token', 'Invalid or expired access token')
      return { adminId: 'admin-a', role: 'tenant_admin' as const, tenantId: 'tenant-a' }
    }),
    resolveWidget: vi.fn(async (key: string, origin: string, _requestId: string, customerToken?: string) => {
      if (key === 'wk_suspended') throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
      if (key !== KEY) throw new AppError(401, 'invalid_widget_key', 'Unknown widget key')
      if (origin !== SHOP && origin !== 'https://other.shop.example') throw new AppError(403, 'origin_not_allowed', 'Not allowed')
      if (customerToken === undefined) return { tenantId: 'tenant-a' }
      const sub = subOf(customerToken)
      if (!sub || sub === 'cust_bad') throw new AppError(401, 'invalid_customer_token', 'Invalid customer token')
      return { tenantId: 'tenant-a', customerId: sub }
    }),
  }
}

const widget = (extra: Record<string, string> = {}) => ({ 'x-helpix-widget-key': KEY, origin: SHOP, ...extra })
const json = { 'content-type': 'application/json' }

describe('gateway widget surface', () => {
  let auth: Awaited<ReturnType<typeof startEcho>>
  let chat: Awaited<ReturnType<typeof startEcho>>
  let kb: Awaited<ReturnType<typeof startEcho>>
  let tenantAuth: ReturnType<typeof fakeTenantAuth>
  let gw: FastifyInstance

  async function build(widgetBundlePath = '/nonexistent/helpix-widget.js') {
    gw = await buildGateway({ config: { ...testConfig(auth.url, kb.url, chat.url), widgetBundlePath }, tenantAuth })
  }

  beforeEach(async () => {
    auth = await startEcho()
    chat = await startEcho()
    kb = await startEcho()
    tenantAuth = fakeTenantAuth()
    await build()
  })
  afterEach(async () => {
    await gw.close()
    await Promise.all([auth.close(), chat.close(), kb.close()])
  })

  it('forwards POST /chat/messages to chat-service with only the tenant identity', async () => {
    const res = await gw.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...widget(), ...json, 'x-tenant-id': 'spoofed', 'x-customer-id': 'spoofed', 'x-helpix-role': 'tenant_admin' },
      payload: '{"message":"hi"}',
    })
    expect(res.statusCode).toBe(200)
    const call = chat.calls[0]!
    expect(call.url).toBe('/chat/messages')
    expect(call.headers['x-tenant-id']).toBe('tenant-a')
    expect(call.headers['x-customer-id']).toBeUndefined()
    expect(call.headers['x-helpix-role']).toBeUndefined()
    expect(call.headers['x-admin-id']).toBeUndefined()
    expect(call.headers['x-helpix-widget-key']).toBeUndefined()
    expect(call.body).toBe('{"message":"hi"}')
  })

  it('forwards GET /widget/config to tenant-auth', async () => {
    const res = await gw.inject({ method: 'GET', url: '/widget/config', headers: widget() })
    expect(res.statusCode).toBe(200)
    expect(auth.calls.map((c) => c.url)).toEqual(['/widget/config'])
    expect(auth.calls[0]!.headers['x-tenant-id']).toBe('tenant-a')
  })

  it('rejects an unknown widget key (401)', async () => {
    const res = await gw.inject({ method: 'GET', url: '/widget/config', headers: widget({ 'x-helpix-widget-key': 'wk_nope' }) })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('invalid_widget_key')
  })

  it('rejects a request without an Origin before calling the resolver (403)', async () => {
    const res = await gw.inject({ method: 'GET', url: '/widget/config', headers: { 'x-helpix-widget-key': KEY } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('origin_not_allowed')
    expect(tenantAuth.resolveWidget).not.toHaveBeenCalled()
  })

  it('rejects an over-long widget key (401) without calling the resolver', async () => {
    const res = await gw.inject({ method: 'GET', url: '/widget/config', headers: widget({ 'x-helpix-widget-key': 'k'.repeat(201) }) })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('invalid_widget_key')
    expect(tenantAuth.resolveWidget).not.toHaveBeenCalled()
  })

  it('rejects an over-long Origin (403) without calling the resolver', async () => {
    const res = await gw.inject({ method: 'GET', url: '/widget/config', headers: widget({ origin: `https://${'a'.repeat(300)}.example` }) })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('origin_not_allowed')
    expect(tenantAuth.resolveWidget).not.toHaveBeenCalled()
  })

  it('rejects an origin the tenant has not allowed (403)', async () => {
    const res = await gw.inject({ method: 'POST', url: '/chat/messages', headers: { ...widget({ origin: 'https://evil.example' }), ...json }, payload: '{}' })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('origin_not_allowed')
    expect(chat.calls).toHaveLength(0)
  })

  it('rejects a suspended tenant (403)', async () => {
    const res = await gw.inject({ method: 'GET', url: '/widget/config', headers: widget({ 'x-helpix-widget-key': 'wk_suspended' }) })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('tenant_suspended')
  })

  it('rejects a widget key on any other route (403)', async () => {
    for (const [method, url] of [['GET', '/kb/documents'], ['POST', '/auth/login'], ['GET', '/agent/config'], ['GET', '/chat/conversations'], ['GET', '/me']] as const) {
      const res = await gw.inject({ method, url, headers: widget() })
      expect(res.statusCode, `${method} ${url}`).toBe(403)
    }
    expect(tenantAuth.resolveWidget).not.toHaveBeenCalled()
    expect(auth.calls.length + kb.calls.length + chat.calls.length).toBe(0)
  })

  it('rejects a widget key together with a bearer token (400)', async () => {
    for (const url of ['/widget/config', '/kb/documents']) {
      const res = await gw.inject({ method: 'GET', url, headers: { ...widget(), authorization: 'Bearer tenant-token' } })
      expect(res.statusCode, url).toBe(400)
      expect(res.json().error.code).toBe('ambiguous_credentials')
    }
  })

  it('rejects a bearer token alone on widget routes (403) and no credential (401)', async () => {
    const admin = await gw.inject({ method: 'POST', url: '/chat/messages', headers: { authorization: 'Bearer tenant-token', origin: SHOP, ...json }, payload: '{}' })
    expect(admin.statusCode).toBe(403)
    const none = await gw.inject({ method: 'GET', url: '/widget/config', headers: { origin: SHOP } })
    expect(none.statusCode).toBe(401)
    expect(chat.calls.length + auth.calls.length).toBe(0)
  })

  it('still routes the admin /chat/* routes with a bearer token', async () => {
    const res = await gw.inject({ method: 'GET', url: '/chat/conversations', headers: { authorization: 'Bearer tenant-token' } })
    expect(res.statusCode).toBe(200)
    expect(chat.calls[0]!.headers['x-helpix-role']).toBe('tenant_admin')
  })

  it('caches per key and origin', async () => {
    await gw.inject({ method: 'GET', url: '/widget/config', headers: widget() })
    await gw.inject({ method: 'GET', url: '/widget/config', headers: widget() })
    expect(tenantAuth.resolveWidget).toHaveBeenCalledTimes(1)
    await gw.inject({ method: 'GET', url: '/widget/config', headers: widget({ origin: 'https://other.shop.example' }) })
    expect(tenantAuth.resolveWidget).toHaveBeenCalledTimes(2)
  })

  it('does not cache resolver errors', async () => {
    const bad = widget({ origin: 'https://evil.example' })
    await gw.inject({ method: 'GET', url: '/widget/config', headers: bad })
    await gw.inject({ method: 'GET', url: '/widget/config', headers: bad })
    expect(tenantAuth.resolveWidget).toHaveBeenCalledTimes(2)
  })

  it('answers widget preflights from any origin without calling the resolver', async () => {
    const res = await gw.inject({
      method: 'OPTIONS',
      url: '/chat/messages',
      headers: { origin: 'https://any-shop.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-helpix-widget-key' },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('https://any-shop.example')
    expect(String(res.headers['access-control-allow-headers'])).toContain('x-helpix-widget-key')
    expect(tenantAuth.resolveWidget).not.toHaveBeenCalled()
  })

  it('keeps the admin CORS allowlist on other routes', async () => {
    const res = await gw.inject({
      method: 'OPTIONS',
      url: '/kb/documents',
      headers: { origin: 'https://any-shop.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
    })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('serves the widget bundle, and 404s when it has not been built', async () => {
    expect((await gw.inject({ method: 'GET', url: '/widget/helpix-widget.js' })).statusCode).toBe(404)
    const dir = await mkdtemp(join(tmpdir(), 'helpix-widget-'))
    const file = join(dir, 'helpix-widget.js')
    await writeFile(file, 'console.log("helpix")')
    await gw.close()
    await build(file)
    const res = await gw.inject({ method: 'GET', url: '/widget/helpix-widget.js' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/javascript; charset=utf-8')
    expect(res.headers['cache-control']).toBe('public, max-age=300')
    expect(res.body).toBe('console.log("helpix")')
  })

  it('forwards the verified customer as x-customer-id, never the token or a client-sent customer id', async () => {
    const token = fakeJwt({ sub: 'cust_maya', exp: inAnHour() })
    const res = await gw.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...widget({ 'x-helpix-customer-token': token, 'x-customer-id': 'cust_spoofed' }), ...json },
      payload: '{"message":"where is my order?"}',
    })
    expect(res.statusCode).toBe(200)
    expect(tenantAuth.resolveWidget).toHaveBeenCalledWith(KEY, SHOP, expect.any(String), token)
    const call = chat.calls[0]!
    expect(call.headers['x-tenant-id']).toBe('tenant-a')
    expect(call.headers['x-customer-id']).toBe('cust_maya')
    expect(call.headers['x-helpix-customer-token']).toBeUndefined()
    expect(call.headers['x-helpix-widget-key']).toBeUndefined()
  })

  it('resolves an anonymous visitor without a token', async () => {
    await gw.inject({ method: 'GET', url: '/widget/config', headers: widget({ 'x-customer-id': 'cust_spoofed' }) })
    expect(tenantAuth.resolveWidget.mock.calls[0]![3]).toBeUndefined()
    expect(auth.calls[0]!.headers['x-customer-id']).toBeUndefined()
  })

  it('passes a 401 invalid_customer_token through and does not cache it', async () => {
    const bad = widget({ 'x-helpix-customer-token': fakeJwt({ sub: 'cust_bad', exp: inAnHour() }) })
    for (let i = 0; i < 2; i++) {
      const res = await gw.inject({ method: 'POST', url: '/chat/messages', headers: { ...bad, ...json }, payload: '{"message":"hi"}' })
      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('invalid_customer_token')
    }
    expect(tenantAuth.resolveWidget).toHaveBeenCalledTimes(2)
    expect(chat.calls).toHaveLength(0)
  })

  it('rejects an over-long customer token (401) without calling the resolver', async () => {
    const res = await gw.inject({ method: 'GET', url: '/widget/config', headers: widget({ 'x-helpix-customer-token': 't'.repeat(4097) }) })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('invalid_customer_token')
    expect(tenantAuth.resolveWidget).not.toHaveBeenCalled()
    expect(auth.calls).toHaveLength(0)
  })

  it('caches per token: another token, or no token, resolves again', async () => {
    const maya = widget({ 'x-helpix-customer-token': fakeJwt({ sub: 'cust_maya', exp: inAnHour() }) })
    const leo = widget({ 'x-helpix-customer-token': fakeJwt({ sub: 'cust_leo', exp: inAnHour() }) })
    await gw.inject({ method: 'GET', url: '/widget/config', headers: maya })
    await gw.inject({ method: 'GET', url: '/widget/config', headers: maya })
    expect(tenantAuth.resolveWidget).toHaveBeenCalledTimes(1)
    await gw.inject({ method: 'GET', url: '/widget/config', headers: leo })
    expect(tenantAuth.resolveWidget).toHaveBeenCalledTimes(2)
    await gw.inject({ method: 'GET', url: '/widget/config', headers: widget() })
    expect(tenantAuth.resolveWidget).toHaveBeenCalledTimes(3)
    expect(auth.calls.map((c) => c.headers['x-customer-id'])).toEqual(['cust_maya', 'cust_maya', 'cust_leo', undefined])
  })

  it('allows the customer token header on widget preflights', async () => {
    const res = await gw.inject({
      method: 'OPTIONS',
      url: '/chat/messages',
      headers: {
        origin: 'https://any-shop.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-helpix-widget-key,x-helpix-customer-token',
      },
    })
    expect(res.statusCode).toBe(204)
    expect(String(res.headers['access-control-allow-headers'])).toContain('x-helpix-customer-token')
    expect(tenantAuth.resolveWidget).not.toHaveBeenCalled()
  })
})

describe('createWidgetIdentity cache TTL', () => {
  const T0 = 1_900_000_000_000
  let clock = T0
  const resolveWidget = vi.fn(async (_key: string, _origin: string, _requestId: string, customerToken?: string) =>
    customerToken === undefined ? { tenantId: 'tenant-a' } : { tenantId: 'tenant-a', customerId: 'cust_maya' },
  )
  const tenantAuth = { resolveAdmin: vi.fn(), resolveWidget } as unknown as TenantAuthClient
  const req = (token?: string) =>
    ({ id: 'req-1', headers: { 'x-helpix-widget-key': KEY, origin: SHOP, ...(token ? { 'x-helpix-customer-token': token } : {}) } }) as unknown as FastifyRequest
  const identity = () => createWidgetIdentity(tenantAuth, 30_000, () => clock)

  beforeEach(() => {
    clock = T0
    resolveWidget.mockClear()
  })

  it('returns the tenant and the customer', async () => {
    const resolve = identity()
    expect(await resolve(req(fakeJwt({ sub: 'cust_maya', exp: T0 / 1000 + 3600 })))).toEqual({ 'x-tenant-id': 'tenant-a', 'x-customer-id': 'cust_maya' })
    expect(await resolve(req())).toEqual({ 'x-tenant-id': 'tenant-a' })
  })

  it('caps the TTL at the token exp', async () => {
    const resolve = identity()
    const token = fakeJwt({ sub: 'cust_maya', exp: T0 / 1000 + 10 })
    await resolve(req(token))
    clock = T0 + 9_000
    await resolve(req(token))
    expect(resolveWidget).toHaveBeenCalledTimes(1)
    clock = T0 + 10_000
    await resolve(req(token))
    expect(resolveWidget).toHaveBeenCalledTimes(2)
  })

  it('uses the resolve TTL when exp is further away', async () => {
    const resolve = identity()
    const token = fakeJwt({ sub: 'cust_maya', exp: T0 / 1000 + 3600 })
    await resolve(req(token))
    clock = T0 + 29_999
    await resolve(req(token))
    expect(resolveWidget).toHaveBeenCalledTimes(1)
    clock = T0 + 30_000
    await resolve(req(token))
    expect(resolveWidget).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['exp is missing', fakeJwt({ sub: 'cust_maya' })],
    ['exp is not a number', fakeJwt({ sub: 'cust_maya', exp: 'soon' })],
    ['the payload is not JSON', `${b64url({ alg: 'RS256' })}.bm90IGpzb24.c2ln`],
    ['the token has no payload', 'just-one-part'],
    ['exp has already passed (inside the clock tolerance)', fakeJwt({ sub: 'cust_maya', exp: T0 / 1000 - 5 })],
  ])('does not cache when %s', async (_label, token) => {
    const resolve = identity()
    await resolve(req(token))
    await resolve(req(token))
    expect(resolveWidget).toHaveBeenCalledTimes(2)
  })
})
