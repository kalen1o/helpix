import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@helpix/shared'
import { buildGateway } from '../src/app'
import type { TenantAuthClient } from '../src/tenantAuthClient'
import { startEcho, testConfig } from './helpers'

const SHOP = 'https://shop.example'
const KEY = 'wk_live_a'

function fakeTenantAuth(): TenantAuthClient & { resolveWidget: ReturnType<typeof vi.fn> } {
  return {
    resolveAdmin: vi.fn(async (token: string) => {
      if (token !== 'tenant-token') throw new AppError(401, 'invalid_token', 'Invalid or expired access token')
      return { adminId: 'admin-a', role: 'tenant_admin' as const, tenantId: 'tenant-a' }
    }),
    resolveWidget: vi.fn(async (key: string, origin: string) => {
      if (key === 'wk_suspended') throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
      if (key !== KEY) throw new AppError(401, 'invalid_widget_key', 'Unknown widget key')
      if (origin !== SHOP && origin !== 'https://other.shop.example') throw new AppError(403, 'origin_not_allowed', 'Not allowed')
      return { tenantId: 'tenant-a' }
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
})
