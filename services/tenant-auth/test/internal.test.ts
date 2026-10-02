import type { FastifyInstance } from 'fastify'
import type { Db } from '@helpix/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { parseShopPublicKey } from '../src/lib/shopKey'
import { createTokenService } from '../src/lib/tokens'
import { setShopKey } from '../src/repos/integrations'
import { setTenantStatus } from '../src/repos/tenants'
import { buildTestApp, customerClaims, internalHeaders, mintCustomerToken, newShopKeyPair, nowSeconds, resetDb, resolverHeaders, seedAdmin, seedTenant, setupTestDb, superAdminHeaders, TEST_CONFIG, type ShopKeyPair } from './helpers'

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
  app.inject({ method: 'POST', url: '/internal/resolve-admin', headers: resolverHeaders(), payload: { accessToken } })
const resolveWidget = (widgetKey: string, origin: string | null) =>
  app.inject({ method: 'POST', url: '/internal/resolve-widget', headers: resolverHeaders(), payload: { widgetKey, origin } })

describe('internal caller header', () => {
  const routes = [
    { url: '/internal/resolve-admin', payload: { accessToken: 'x' } },
    { url: '/internal/resolve-widget', payload: { widgetKey: 'wk_x', origin: null } },
  ]

  it.each(routes)('rejects $url with a valid internal token but no x-internal-caller', async ({ url, payload }) => {
    const res = await app.inject({ method: 'POST', url, headers: internalHeaders(), payload })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatchObject({ code: 'forbidden', requestId: expect.any(String) })
  })

  it.each(routes)('rejects $url forwarded as a super-admin request with the wrong caller', async ({ url, payload }) => {
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { ...superAdminHeaders('00000000-0000-0000-0000-000000000001'), 'x-internal-caller': 'gateway' },
      payload,
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('forbidden')
  })
})

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

describe('POST /internal/resolve-widget with a customer token', () => {
  const ORIGIN = 'https://shop.example'
  let shopKeys: ShopKeyPair

  beforeAll(async () => { shopKeys = await newShopKeyPair() })

  async function shopTenant(slug: string, opts: { withKey?: boolean } = {}) {
    const t = await seedTenant(db, { slug, allowedOrigins: [ORIGIN] })
    if (opts.withKey !== false) {
      const key = await parseShopPublicKey(shopKeys.publicPem)
      await setShopKey(db, t.id, key.pem, key.fingerprint)
    }
    return t
  }
  const resolveWithToken = (widgetKey: string, customerToken: string, origin: string | null = ORIGIN) =>
    app.inject({ method: 'POST', url: '/internal/resolve-widget', headers: resolverHeaders(), payload: { widgetKey, origin, customerToken } })
  const expect401 = (res: { statusCode: number; json: () => { error: { code: string } } }) => {
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('invalid_customer_token')
  }

  it('returns the verified customer with the tenant', async () => {
    const t = await shopTenant('shop')
    const token = await mintCustomerToken(shopKeys.privateKey, customerClaims(t.widgetKey))
    const res = await resolveWithToken(t.widgetKey, token)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ tenantId: t.id, customerId: 'cust_maya' })
  })

  it('omits customerId when no token is sent', async () => {
    const t = await shopTenant('shop')
    expect((await resolveWidget(t.widgetKey, ORIGIN)).json()).toEqual({ tenantId: t.id })
  })

  it('rejects a token whose aud is another widget key', async () => {
    // Both tenants trust the same shop key, so only `aud` stops a token minted for B being replayed on A.
    const a = await shopTenant('shop-a')
    const b = await shopTenant('shop-b')
    const tokenForB = await mintCustomerToken(shopKeys.privateKey, customerClaims(b.widgetKey))
    expect401(await resolveWithToken(a.widgetKey, tokenForB))
    expect((await resolveWithToken(b.widgetKey, tokenForB)).json()).toEqual({ tenantId: b.id, customerId: 'cust_maya' })
  })

  it("rejects a token signed with a key other than the tenant's", async () => {
    const t = await shopTenant('shop')
    const stranger = await newShopKeyPair()
    expect401(await resolveWithToken(t.widgetKey, await mintCustomerToken(stranger.privateKey, customerClaims(t.widgetKey))))
  })

  it('rejects an expired token', async () => {
    const t = await shopTenant('shop')
    const now = nowSeconds()
    const token = await mintCustomerToken(shopKeys.privateKey, customerClaims(t.widgetKey, { iat: now - 3000, exp: now - 120 }))
    expect401(await resolveWithToken(t.widgetKey, token))
  })

  it('returns 401 when the tenant has no shop key', async () => {
    const t = await shopTenant('shop', { withKey: false })
    expect401(await resolveWithToken(t.widgetKey, await mintCustomerToken(shopKeys.privateKey, customerClaims(t.widgetKey))))
  })

  it('checks the widget key, tenant status and origin before the token', async () => {
    const t = await shopTenant('shop')
    const token = await mintCustomerToken(shopKeys.privateKey, customerClaims(t.widgetKey))
    expect((await resolveWithToken('wk_nope', token)).json().error.code).toBe('invalid_widget_key')
    expect((await resolveWithToken(t.widgetKey, token, 'https://evil.example')).json().error.code).toBe('origin_not_allowed')
    await setTenantStatus(db, t.id, 'suspended')
    expect((await resolveWithToken(t.widgetKey, token)).json().error.code).toBe('tenant_suspended')
  })

  it('rejects an empty or over-4096-character token at validation', async () => {
    const t = await shopTenant('shop')
    expect((await resolveWithToken(t.widgetKey, '')).statusCode).toBe(400)
    expect((await resolveWithToken(t.widgetKey, 'x'.repeat(4097))).statusCode).toBe(400)
  })
})
