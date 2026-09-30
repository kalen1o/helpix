import type { FastifyInstance } from 'fastify'
import type { Db } from '@helpix/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setTenantStatus } from '../src/repos/tenants'
import { buildTestApp, internalHeaders, resetDb, seedAdmin, seedTenant, setupTestDb } from './helpers'

let db: Db
let app: FastifyInstance

beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(db)
})
afterEach(async () => { await app.close() })

const login = (email: string, password: string) =>
  app.inject({ method: 'POST', url: '/auth/login', headers: internalHeaders(), payload: { email, password } })

describe('POST /auth/login', () => {
  it('rejects requests without the internal token', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'a@b.co', password: 'x' } })
    expect(res.statusCode).toBe(401)
  })

  it('logs in a super-admin and returns tokens and profile without the hash', async () => {
    await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
    const res = await login('root@helpix.test', 'password-1')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.accessToken).toEqual(expect.any(String))
    expect(body.refreshToken).toEqual(expect.any(String))
    expect(body.admin).toMatchObject({ email: 'root@helpix.test', role: 'super_admin', tenantId: null })
    expect(JSON.stringify(body)).not.toMatch(/password/i)
  })

  it('treats email case and surrounding whitespace as the same account', async () => {
    await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
    expect((await login('  Root@Helpix.TEST ', 'password-1')).statusCode).toBe(200)
  })

  it('returns the same error for a wrong password and an unknown email', async () => {
    await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
    const wrong = await login('root@helpix.test', 'nope-nope')
    const unknown = await login('ghost@helpix.test', 'nope-nope')
    expect(wrong.statusCode).toBe(401)
    expect(unknown.statusCode).toBe(401)
    expect(wrong.json().error.code).toBe('invalid_credentials')
    expect(unknown.json().error.code).toBe('invalid_credentials')
  })

  it('blocks login for admins of a suspended tenant', async () => {
    const t = await seedTenant(db, { slug: 'shop', status: 'suspended' })
    await seedAdmin(db, { email: 'owner@shop.test', password: 'password-1', role: 'tenant_admin', tenantId: t.id })
    const res = await login('owner@shop.test', 'password-1')
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('tenant_suspended')
  })
})

describe('POST /auth/refresh and /auth/logout', () => {
  async function sessionFor(email: string) {
    return (await login(email, 'password-1')).json() as { refreshToken: string; accessToken: string }
  }
  const refresh = (refreshToken: string) =>
    app.inject({ method: 'POST', url: '/auth/refresh', headers: internalHeaders(), payload: { refreshToken } })

  it('issues a new session and makes the old refresh token single-use', async () => {
    await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
    const s = await sessionFor('root@helpix.test')
    const first = await refresh(s.refreshToken)
    expect(first.statusCode).toBe(200)
    expect(first.json().refreshToken).not.toBe(s.refreshToken)
    const reuse = await refresh(s.refreshToken)
    expect(reuse.statusCode).toBe(401)
    expect(reuse.json().error.code).toBe('invalid_refresh_token')
  })

  it('rejects refresh once the tenant has been suspended', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    await seedAdmin(db, { email: 'owner@shop.test', password: 'password-1', role: 'tenant_admin', tenantId: t.id })
    const s = await sessionFor('owner@shop.test')
    await setTenantStatus(db, t.id, 'suspended')
    const res = await refresh(s.refreshToken)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('tenant_suspended')
  })

  it('logout revokes the refresh token', async () => {
    await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
    const s = await sessionFor('root@helpix.test')
    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: internalHeaders(), payload: { refreshToken: s.refreshToken } })
    expect(out.statusCode).toBe(204)
    expect((await refresh(s.refreshToken)).statusCode).toBe(401)
  })
})
