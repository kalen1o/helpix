import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@helpix/shared'
import { buildGateway } from '../src/app'
import type { TenantAuthClient } from '../src/tenantAuthClient'
import { rawRequest, startEcho, testConfig } from './helpers'

let auth: Awaited<ReturnType<typeof startEcho>>
let kb: Awaited<ReturnType<typeof startEcho>>
let gw: FastifyInstance

const tenantAuth: TenantAuthClient = {
  resolveAdmin: vi.fn(async (token: string) => {
    if (token !== 'tenant-token') throw new AppError(401, 'invalid_token', 'Invalid or expired access token')
    return { adminId: 'admin-a', role: 'tenant_admin' as const, tenantId: 'tenant-a' }
  }),
  resolveWidget: vi.fn(async () => { throw new AppError(401, 'invalid_widget_key', 'Unknown widget key') }),
}

beforeEach(async () => {
  auth = await startEcho()
  kb = await startEcho()
  gw = await buildGateway({ config: testConfig(auth.url, kb.url), tenantAuth })
})
afterEach(async () => {
  await gw.close()
  await auth.close()
  await kb.close()
})

const bearer = { authorization: 'Bearer tenant-token' }
const post = (url: string, bytes: number) =>
  gw.inject({ method: 'POST', url, headers: { ...bearer, 'content-type': 'text/plain' }, payload: 'x'.repeat(bytes) })

describe('gateway /kb/* routes', () => {
  it('forwards to kb-service with the tenant identity and without the bearer token', async () => {
    const res = await gw.inject({ method: 'GET', url: '/kb/documents?x=1', headers: { ...bearer, 'x-tenant-id': 'tenant-b' } })
    expect(res.statusCode).toBe(200)
    expect(auth.calls).toHaveLength(0)
    expect(kb.calls).toHaveLength(1)
    const call = kb.calls[0]!
    expect(call.url).toBe('/kb/documents?x=1')
    expect(call.headers['x-tenant-id']).toBe('tenant-a')
    expect(call.headers['x-helpix-role']).toBe('tenant_admin')
    expect(call.headers['x-internal-token']).toBeDefined()
    expect(call.headers.authorization).toBeUndefined()
  })

  it('requires a bearer token', async () => {
    const res = await gw.inject({ method: 'GET', url: '/kb/documents' })
    expect(res.statusCode).toBe(401)
    expect(kb.calls).toHaveLength(0)
  })

  it('allows larger bodies only for KB uploads', async () => {
    expect((await post('/kb/documents', 3000)).statusCode).toBe(200)
    expect((await post('/kb/documents/text', 3000)).statusCode).toBe(200)
    expect((await post('/kb/documents', 5000)).statusCode).toBe(413)
    expect((await post('/kb/search', 3000)).statusCode).toBe(413)
    expect((await post('/kb/documents/abc/retry', 3000)).statusCode).toBe(413)
    expect((await post('/admin/tenants', 3000)).statusCode).toBe(413)
  })

  it('rejects path traversal out of /kb before resolving the token', async () => {
    await gw.listen({ port: 0, host: '127.0.0.1' })
    const { port } = gw.server.address() as AddressInfo
    for (const path of ['/kb/../admin/tenants', '/kb/%2e%2e/internal/resolve-admin']) {
      const res = await rawRequest(port, { method: 'GET', path, headers: bearer })
      expect(res.status).toBe(404)
    }
    expect(kb.calls).toHaveLength(0)
    expect(auth.calls).toHaveLength(0)
  })
})
