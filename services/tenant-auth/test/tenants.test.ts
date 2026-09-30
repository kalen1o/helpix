import type { FastifyInstance } from 'fastify'
import type { Db } from '@helpix/shared'
import type { AdminView } from '@helpix/shared/api-types'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findTenantByWidgetKey } from '../src/repos/tenants'
import { buildTestApp, internalHeaders, resetDb, seedAdmin, seedTenant, setupTestDb, superAdminHeaders, tenantAdminHeaders } from './helpers'

let db: Db
let app: FastifyInstance
let root: AdminView

beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(db)
  root = await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
})
afterEach(async () => { await app.close() })

const asRoot = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({ method, url, headers: superAdminHeaders(root.id), ...(payload ? { payload } : {}) })

describe('access control', () => {
  it('rejects tenant admins with 403', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    const res = await app.inject({ method: 'GET', url: '/admin/tenants', headers: tenantAdminHeaders('00000000-0000-0000-0000-000000000001', t.id) })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('forbidden')
  })

  it('rejects requests with no role with 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/tenants', headers: internalHeaders() })
    expect(res.statusCode).toBe(403)
  })
})

describe('tenants', () => {
  it('creates a tenant with a widget key and no origins', async () => {
    const res = await asRoot('POST', '/admin/tenants', { name: 'iPhone Store', slug: 'iphone-store' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name: 'iPhone Store', slug: 'iphone-store', status: 'active', allowedOrigins: [] })
    expect(res.json().widgetKey).toMatch(/^wk_/)
  })

  it('returns 409 slug_taken for a duplicate slug', async () => {
    await asRoot('POST', '/admin/tenants', { name: 'A', slug: 'shop' })
    const res = await asRoot('POST', '/admin/tenants', { name: 'B', slug: 'shop' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('slug_taken')
  })

  it('rejects an invalid slug with 400', async () => {
    const res = await asRoot('POST', '/admin/tenants', { name: 'Bad', slug: 'Bad Slug' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
  })

  it('lists tenants', async () => {
    await seedTenant(db, { slug: 'one' })
    await seedTenant(db, { slug: 'two' })
    const res = await asRoot('GET', '/admin/tenants')
    expect(res.json().tenants.map((t: { slug: string }) => t.slug).sort()).toEqual(['one', 'two'])
  })

  it('returns 404 for an unknown id and 400 for a malformed id', async () => {
    expect((await asRoot('GET', '/admin/tenants/00000000-0000-0000-0000-000000000000')).json().error.code).toBe('tenant_not_found')
    expect((await asRoot('GET', '/admin/tenants/not-a-uuid')).statusCode).toBe(400)
  })

  it('normalizes allowed origins on PATCH', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    const res = await asRoot('PATCH', `/admin/tenants/${t.id}`, {
      allowedOrigins: ['https://Shop.Example/', ' http://localhost:5174 ', '', 'https://shop.example'],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().allowedOrigins).toEqual(['https://shop.example', 'http://localhost:5174'])
  })

  it('rejects an origin with a path and leaves the tenant unchanged', async () => {
    const t = await seedTenant(db, { slug: 'shop', allowedOrigins: ['https://shop.example'] })
    const res = await asRoot('PATCH', `/admin/tenants/${t.id}`, { allowedOrigins: ['https://shop.example/about'] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('invalid_origin')
    expect((await asRoot('GET', `/admin/tenants/${t.id}`)).json().allowedOrigins).toEqual(['https://shop.example'])
  })

  it('renames a tenant', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    expect((await asRoot('PATCH', `/admin/tenants/${t.id}`, { name: 'New Name' })).json().name).toBe('New Name')
  })

  it('suspends and reactivates', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    expect((await asRoot('POST', `/admin/tenants/${t.id}/suspend`)).json().status).toBe('suspended')
    expect((await asRoot('POST', `/admin/tenants/${t.id}/reactivate`)).json().status).toBe('active')
  })

  it('rotates the widget key so the old key no longer resolves', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    const res = await asRoot('POST', `/admin/tenants/${t.id}/widget-key/rotate`)
    expect(res.json().widgetKey).not.toBe(t.widgetKey)
    expect(await findTenantByWidgetKey(db, t.widgetKey)).toBeNull()
  })
})

describe('tenant admins', () => {
  it('creates a tenant admin with a normalized email and no hash in the response', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    const res = await asRoot('POST', `/admin/tenants/${t.id}/admins`, { email: '  Owner@Shop.COM ', password: 'password-1' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ email: 'owner@shop.com', role: 'tenant_admin', tenantId: t.id })
    expect(res.body).not.toMatch(/password/i)
  })

  it('returns 409 email_taken for an email used by any admin, in any case', async () => {
    const a = await seedTenant(db, { slug: 'a' })
    const b = await seedTenant(db, { slug: 'b' })
    await asRoot('POST', `/admin/tenants/${a.id}/admins`, { email: 'owner@shop.com', password: 'password-1' })
    const res = await asRoot('POST', `/admin/tenants/${b.id}/admins`, { email: 'OWNER@shop.com', password: 'password-1' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('email_taken')
  })

  it('rejects a short password and an invalid email', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    expect((await asRoot('POST', `/admin/tenants/${t.id}/admins`, { email: 'o@shop.com', password: 'short' })).statusCode).toBe(400)
    const bad = await asRoot('POST', `/admin/tenants/${t.id}/admins`, { email: 'not an email', password: 'password-1' })
    expect(bad.json().error.code).toBe('invalid_email')
  })

  it('returns 404 for an unknown tenant', async () => {
    const res = await asRoot('POST', '/admin/tenants/00000000-0000-0000-0000-000000000000/admins', { email: 'o@shop.com', password: 'password-1' })
    expect(res.statusCode).toBe(404)
  })

  it('lists only that tenant\'s admins', async () => {
    const a = await seedTenant(db, { slug: 'a' })
    const b = await seedTenant(db, { slug: 'b' })
    await seedAdmin(db, { email: 'a@a.test', password: 'password-1', role: 'tenant_admin', tenantId: a.id })
    await seedAdmin(db, { email: 'b@b.test', password: 'password-1', role: 'tenant_admin', tenantId: b.id })
    const res = await asRoot('GET', `/admin/tenants/${a.id}/admins`)
    expect(res.json().admins.map((x: { email: string }) => x.email)).toEqual(['a@a.test'])
  })
})
