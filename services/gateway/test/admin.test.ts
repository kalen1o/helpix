import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@helpix/shared'
import type { ResolvedAdmin } from '@helpix/shared/api-types'
import { buildGateway } from '../src/app'
import type { TenantAuthClient } from '../src/tenantAuthClient'
import { startEcho, testConfig } from './helpers'

let echo: Awaited<ReturnType<typeof startEcho>>
let gw: FastifyInstance
let tenantAuth: TenantAuthClient & { resolveAdmin: ReturnType<typeof vi.fn> }

const IDENTITIES: Record<string, ResolvedAdmin> = {
  'super-token': { adminId: 'admin-super', role: 'super_admin', tenantId: null },
  'tenant-token': { adminId: 'admin-a', role: 'tenant_admin', tenantId: 'tenant-a' },
}

beforeEach(async () => {
  echo = await startEcho()
  tenantAuth = {
    resolveAdmin: vi.fn(async (token: string) => {
      if (token === 'suspended-token') throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
      const id = IDENTITIES[token]
      if (!id) throw new AppError(401, 'invalid_token', 'Invalid or expired access token')
      return id
    }),
    resolveWidget: vi.fn(async () => { throw new AppError(401, 'invalid_widget_key', 'Unknown widget key') }),
  }
  gw = await buildGateway({ config: testConfig(echo.url), tenantAuth })
})
afterEach(async () => {
  await gw.close()
  await echo.close()
})

const get = (url: string, headers: Record<string, string> = {}) => gw.inject({ method: 'GET', url, headers })

describe('admin routes', () => {
  it('rejects a missing bearer token with 401 without calling upstream', async () => {
    const res = await get('/admin/tenants')
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthorized')
    expect(echo.calls).toHaveLength(0)
  })

  it('propagates invalid_token and tenant_suspended', async () => {
    expect((await get('/me', { authorization: 'Bearer nope' })).json().error.code).toBe('invalid_token')
    const suspended = await get('/me', { authorization: 'Bearer suspended-token' })
    expect(suspended.statusCode).toBe(403)
    expect(suspended.json().error.code).toBe('tenant_suspended')
  })

  it('forwards a tenant admin with resolved identity headers and no authorization', async () => {
    const res = await get('/me', { authorization: 'Bearer tenant-token' })
    expect(res.statusCode).toBe(200)
    const h = echo.calls[0]!.headers
    expect(h['x-admin-id']).toBe('admin-a')
    expect(h['x-helpix-role']).toBe('tenant_admin')
    expect(h['x-tenant-id']).toBe('tenant-a')
    expect(h.authorization).toBeUndefined()
  })

  it('overrides spoofed identity headers with the resolved ones', async () => {
    await get('/me', { authorization: 'Bearer tenant-token', 'x-tenant-id': 'tenant-b', 'x-helpix-role': 'super_admin' })
    const h = echo.calls[0]!.headers
    expect(h['x-tenant-id']).toBe('tenant-a')
    expect(h['x-helpix-role']).toBe('tenant_admin')
  })

  it('sends no tenant header for a super-admin even if the client sends one', async () => {
    await get('/admin/tenants', { authorization: 'Bearer super-token', 'x-tenant-id': 'tenant-b' })
    const h = echo.calls[0]!.headers
    expect(h['x-helpix-role']).toBe('super_admin')
    expect(h['x-tenant-id']).toBeUndefined()
  })

  it('caches successful resolutions', async () => {
    await get('/me', { authorization: 'Bearer tenant-token' })
    await get('/me', { authorization: 'Bearer tenant-token' })
    expect(tenantAuth.resolveAdmin).toHaveBeenCalledTimes(1)
  })

  it('does not cache failures', async () => {
    await get('/me', { authorization: 'Bearer nope' })
    await get('/me', { authorization: 'Bearer nope' })
    expect(tenantAuth.resolveAdmin).toHaveBeenCalledTimes(2)
  })
})

describe('CORS', () => {
  it('answers a preflight from an allowed origin', async () => {
    const res = await gw.inject({
      method: 'OPTIONS',
      url: '/admin/tenants',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization,content-type' },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(echo.calls).toHaveLength(0)
  })

  it('does not allow other origins', async () => {
    const res = await gw.inject({
      method: 'OPTIONS',
      url: '/admin/tenants',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('forwards /integrations and everything under it to tenant-auth with the admin identity', async () => {
    await gw.close()
    gw = await buildGateway({ config: testConfig(echo.url, 'http://127.0.0.1:1', 'http://127.0.0.1:1'), tenantAuth })
    const requests = [
      ['GET', '/integrations'],
      ['PUT', '/integrations/order-api'],
      ['POST', '/integrations/order-api/test'],
      ['DELETE', '/integrations/shop-key'],
    ] as const
    for (const [method, url] of requests) {
      const hasBody = method === 'PUT' || method === 'POST'
      const res = await gw.inject({
        method,
        url,
        headers: { authorization: 'Bearer tenant-token', 'x-tenant-id': 'tenant-b', ...(hasBody ? { 'content-type': 'application/json' } : {}) },
        ...(hasBody ? { payload: '{}' } : {}),
      })
      expect(res.statusCode, `${method} ${url}`).toBe(200)
    }
    expect(echo.calls.map((c) => `${c.method} ${c.url}`)).toEqual(requests.map(([m, u]) => `${m} ${u}`))
    for (const c of echo.calls) {
      expect(c.headers['x-tenant-id']).toBe('tenant-a')
      expect(c.headers['x-helpix-role']).toBe('tenant_admin')
      expect(c.headers.authorization).toBeUndefined()
    }
  })

  it('rejects /integrations without a bearer token', async () => {
    const res = await get('/integrations')
    expect(res.statusCode).toBe(401)
    expect(echo.calls).toHaveLength(0)
  })
})
