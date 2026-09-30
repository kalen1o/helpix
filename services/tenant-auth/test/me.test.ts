import type { FastifyInstance } from 'fastify'
import type { Db } from '@helpix/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildTestApp, internalHeaders, resetDb, seedAdmin, seedTenant, setupTestDb, superAdminHeaders, tenantAdminHeaders } from './helpers'

let db: Db
let app: FastifyInstance
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(db)
})
afterEach(async () => { await app.close() })

describe('GET /me', () => {
  it('returns the super-admin with no tenant', async () => {
    const root = await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
    const res = await app.inject({ method: 'GET', url: '/me', headers: superAdminHeaders(root.id) })
    expect(res.json()).toMatchObject({ admin: { email: 'root@helpix.test' }, tenant: null })
  })

  it('returns the tenant admin with their tenant', async () => {
    const t = await seedTenant(db, { name: 'Teen Fashion', slug: 'teen-fashion' })
    const owner = await seedAdmin(db, { email: 'o@teen.test', password: 'password-1', role: 'tenant_admin', tenantId: t.id })
    const res = await app.inject({ method: 'GET', url: '/me', headers: tenantAdminHeaders(owner.id, t.id) })
    expect(res.json()).toMatchObject({ admin: { email: 'o@teen.test' }, tenant: { id: t.id, name: 'Teen Fashion' } })
  })

  it('returns 401 without admin identity', async () => {
    expect((await app.inject({ method: 'GET', url: '/me', headers: internalHeaders() })).statusCode).toBe(401)
  })
})
