import type { FastifyInstance } from 'fastify'
import type { Db } from '@helpix/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTokenService } from '../src/lib/tokens'
import { setTenantStatus } from '../src/repos/tenants'
import { buildTestApp, internalHeaders, resetDb, seedAdmin, seedTenant, setupTestDb, TEST_CONFIG } from './helpers'

let db: Db
let app: FastifyInstance
const tokens = createTokenService(TEST_CONFIG.adminJwtSecret, TEST_CONFIG.accessTtl)

beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(db)
})
afterEach(async () => { await app.close() })

const resolveAdmin = (accessToken: string) =>
  app.inject({ method: 'POST', url: '/internal/resolve-admin', headers: internalHeaders(), payload: { accessToken } })
const resolveWidget = (widgetKey: string, origin: string | null) =>
  app.inject({ method: 'POST', url: '/internal/resolve-widget', headers: internalHeaders(), payload: { widgetKey, origin } })

describe('POST /internal/resolve-admin', () => {
  it('requires the internal token', async () => {
    const res = await app.inject({ method: 'POST', url: '/internal/resolve-admin', payload: { accessToken: 'x' } })
    expect(res.statusCode).toBe(401)
  })

  it('resolves a valid token to the identity stored in the database', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    const owner = await seedAdmin(db, { email: 'o@shop.test', password: 'password-1', role: 'tenant_admin', tenantId: t.id })
    const token = await tokens.signAccess({ adminId: owner.id, role: 'tenant_admin', tenantId: t.id })
    const res = await resolveAdmin(token)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ adminId: owner.id, role: 'tenant_admin', tenantId: t.id })
  })

  it('returns 401 invalid_token for garbage', async () => {
    const res = await resolveAdmin('garbage')
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('invalid_token')
  })

  it('returns 401 for a valid token whose admin was deleted', async () => {
    const token = await tokens.signAccess({ adminId: '00000000-0000-0000-0000-000000000009', role: 'super_admin', tenantId: null })
    expect((await resolveAdmin(token)).statusCode).toBe(401)
  })

  it('returns 403 tenant_suspended for a live token after suspension', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    const owner = await seedAdmin(db, { email: 'o@shop.test', password: 'password-1', role: 'tenant_admin', tenantId: t.id })
    const token = await tokens.signAccess({ adminId: owner.id, role: 'tenant_admin', tenantId: t.id })
    await setTenantStatus(db, t.id, 'suspended')
    const res = await resolveAdmin(token)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('tenant_suspended')
  })
})

describe('POST /internal/resolve-widget', () => {
  it('resolves a key from an allowed origin, normalizing the request origin', async () => {
    const t = await seedTenant(db, { slug: 'shop', allowedOrigins: ['https://shop.example'] })
    const res = await resolveWidget(t.widgetKey, 'https://Shop.Example')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ tenantId: t.id })
  })

  it('returns 401 invalid_widget_key for an unknown key', async () => {
    expect((await resolveWidget('wk_nope', 'https://shop.example')).json().error.code).toBe('invalid_widget_key')
  })

  it('returns 403 origin_not_allowed for another origin or a missing origin', async () => {
    const t = await seedTenant(db, { slug: 'shop', allowedOrigins: ['https://shop.example'] })
    expect((await resolveWidget(t.widgetKey, 'https://evil.example')).json().error.code).toBe('origin_not_allowed')
    expect((await resolveWidget(t.widgetKey, null)).json().error.code).toBe('origin_not_allowed')
  })

  it('returns 403 tenant_suspended for a suspended tenant', async () => {
    const t = await seedTenant(db, { slug: 'shop', allowedOrigins: ['https://shop.example'], status: 'suspended' })
    expect((await resolveWidget(t.widgetKey, 'https://shop.example')).json().error.code).toBe('tenant_suspended')
  })
})
