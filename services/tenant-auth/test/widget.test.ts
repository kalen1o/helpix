import type { FastifyInstance } from 'fastify'
import { DEFAULT_AGENT_CONFIG, HEADERS, type Db } from '@helpix/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { saveDraft, publishDraft } from '../src/repos/agentConfigs'
import { setTenantStatus } from '../src/repos/tenants'
import { buildTestApp, internalHeaders, resetDb, seedTenant, setupTestDb, tenantAdminHeaders } from './helpers'

let db: Db
let app: FastifyInstance

beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(db)
})
afterEach(async () => { await app.close() })

const widgetHeaders = (tenantId: string) => ({ ...internalHeaders(), [HEADERS.tenantId]: tenantId })
const getConfig = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/widget/config', headers })

describe('GET /widget/config', () => {
  it('returns defaults and the shop name before anything is published', async () => {
    const t = await seedTenant(db, { slug: 'orchard', name: 'Orchard Store' })
    const res = await getConfig(widgetHeaders(t.id))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      shopName: 'Orchard Store',
      greeting: DEFAULT_AGENT_CONFIG.greeting,
      accentColor: DEFAULT_AGENT_CONFIG.accentColor,
      orderLookup: false,
    })
  })

  it('returns the published config, not the draft', async () => {
    const t = await seedTenant(db, { slug: 'orchard' })
    await saveDraft(db, t.id, { ...DEFAULT_AGENT_CONFIG, greeting: 'Published hi', accentColor: '#111111' })
    await publishDraft(db, t.id)
    await saveDraft(db, t.id, { ...DEFAULT_AGENT_CONFIG, greeting: 'Draft hi', accentColor: '#222222' })
    expect(res(await getConfig(widgetHeaders(t.id)))).toMatchObject({ greeting: 'Published hi', accentColor: '#111111' })
  })

  it("never returns another tenant's config", async () => {
    const a = await seedTenant(db, { slug: 'shop-a', name: 'Shop A' })
    const b = await seedTenant(db, { slug: 'shop-b', name: 'Shop B' })
    await saveDraft(db, b.id, { ...DEFAULT_AGENT_CONFIG, greeting: 'B only' })
    await publishDraft(db, b.id)
    expect(res(await getConfig(widgetHeaders(a.id)))).toMatchObject({ shopName: 'Shop A', greeting: DEFAULT_AGENT_CONFIG.greeting })
  })

  it('rejects admin callers, a missing or malformed tenant, and suspended tenants', async () => {
    const t = await seedTenant(db, { slug: 'orchard' })
    expect((await getConfig(tenantAdminHeaders('00000000-0000-4000-8000-0000000000a1', t.id))).statusCode).toBe(403)
    expect((await getConfig(internalHeaders())).statusCode).toBe(403)
    expect((await getConfig(widgetHeaders('not-a-uuid'))).statusCode).toBe(403)
    expect((await getConfig(widgetHeaders('00000000-0000-4000-8000-000000000099'))).statusCode).toBe(404)
    await setTenantStatus(db, t.id, 'suspended')
    const suspended = await getConfig(widgetHeaders(t.id))
    expect(suspended.statusCode).toBe(403)
    expect(suspended.json().error.code).toBe('tenant_suspended')
  })

  it('requires the internal token', async () => {
    const t = await seedTenant(db, { slug: 'orchard' })
    expect((await getConfig({ [HEADERS.tenantId]: t.id })).statusCode).toBe(401)
  })
})

function res(r: { statusCode: number; json: () => unknown }) {
  expect(r.statusCode).toBe(200)
  return r.json()
}
