import type { FastifyInstance, InjectOptions } from 'fastify'
import type { Db } from '@helpix/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { encryptSecret } from '../src/lib/secrets'
import { setOrderApi } from '../src/repos/integrations'
import { setTenantStatus } from '../src/repos/tenants'
import { SAMPLE_ORDER, startFakeShop, type FakeShop } from './fakeShop'
import { buildTestApp, chatCallerHeaders, internalHeaders, resetDb, resolverHeaders, seedTenant, setupTestDb, tenantAdminHeaders, TEST_CONFIG } from './helpers'

let db: Db
let app: FastifyInstance
let shop: FakeShop
const bodies: string[] = []
const KEY_A = 'sk_shop_a_0123456789'
const KEY_B = 'sk_shop_b_9876543210'

beforeAll(async () => {
  db = await setupTestDb()
  shop = await startFakeShop()
})
afterAll(async () => {
  await shop.close()
  await db.end()
})
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(db)
  shop.requests.length = 0
  bodies.length = 0
  // Each path prefix is one shop; an order is visible only to its owner, like the demo's order API.
  shop.reply((r) => {
    if (r.authorization !== `Bearer ${r.path.startsWith('/a/') ? KEY_A : KEY_B}`) return { status: 401, json: {} }
    if (r.path.endsWith('/orders')) return { json: { orders: r.customerId === 'cust_maya' ? [SAMPLE_ORDER] : [] } }
    const id = decodeURIComponent(r.path.split('/').pop()!)
    return r.customerId === 'cust_maya' ? { json: { ...SAMPLE_ORDER, orderId: id } } : { status: 404, json: {} }
  })
})
afterEach(async () => {
  await app.close()
  for (const body of bodies) {
    expect(body).not.toContain(KEY_A)
    expect(body).not.toContain(KEY_B)
  }
})

async function call(opts: InjectOptions) {
  const res = await app.inject(opts)
  bodies.push(res.body)
  return res
}
async function shopTenant(slug: string, prefix: 'a' | 'b') {
  const t = await seedTenant(db, { slug })
  await setOrderApi(db, t.id, `${shop.url}/${prefix}`, encryptSecret(prefix === 'a' ? KEY_A : KEY_B, TEST_CONFIG.secretsMasterKey))
  return t
}
const q = (customerId: string) => `customerId=${encodeURIComponent(customerId)}`
const list = (tenantId: string, customerId: string, headers = chatCallerHeaders()) =>
  call({ method: 'GET', url: `/internal/orders/${tenantId}?${q(customerId)}`, headers })
const one = (tenantId: string, orderId: string, customerId: string, headers = chatCallerHeaders()) =>
  call({ method: 'GET', url: `/internal/orders/${tenantId}/${encodeURIComponent(orderId)}?${q(customerId)}`, headers })

describe('GET /internal/orders', () => {
  it("lists the customer's orders through the tenant's own order API", async () => {
    const a = await shopTenant('shop-a', 'a')
    const res = await list(a.id, 'cust_maya')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', orders: [SAMPLE_ORDER] })
    expect(shop.requests).toEqual([
      { path: '/a/orders', query: '?limit=5', authorization: `Bearer ${KEY_A}`, customerId: 'cust_maya', accept: 'application/json' },
    ])
  })

  it('gets one order, URL-encoding its id', async () => {
    const a = await shopTenant('shop-a', 'a')
    const res = await one(a.id, 'A 1?x', 'cust_maya')
    expect(res.json()).toEqual({ status: 'ok', order: { ...SAMPLE_ORDER, orderId: 'A 1?x' } })
    expect(shop.requests[0]!.path).toBe('/a/orders/A%201%3Fx')
  })

  it('uses exactly the customerId it is given', async () => {
    const a = await shopTenant('shop-a', 'a')
    expect((await one(a.id, '1001', 'cust_leo')).json()).toEqual({ status: 'not_found' })
    expect((await list(a.id, 'cust_leo')).json()).toEqual({ status: 'ok', orders: [] })
    expect(shop.requests.map((r) => r.customerId)).toEqual(['cust_leo', 'cust_leo'])
  })

  it("never uses another tenant's order API or key", async () => {
    const a = await shopTenant('shop-a', 'a')
    const b = await shopTenant('shop-b', 'b')
    await list(a.id, 'cust_maya')
    await one(b.id, '1001', 'cust_maya')
    expect(shop.requests.map((r) => [r.path, r.authorization])).toEqual([
      ['/a/orders', `Bearer ${KEY_A}`],
      ['/b/orders/1001', `Bearer ${KEY_B}`],
    ])
  })

  it('returns not_configured without an order API, without calling anything', async () => {
    const t = await seedTenant(db, { slug: 'plain' })
    expect((await list(t.id, 'cust_maya')).json()).toEqual({ status: 'not_configured' })
    expect((await one(t.id, '1001', 'cust_maya')).json()).toEqual({ status: 'not_configured' })
    expect(shop.requests).toHaveLength(0)
  })

  it('passes shop failures through as statuses, never as HTTP errors', async () => {
    const a = await shopTenant('shop-a', 'a')
    shop.reply(() => ({ status: 401, json: {} }))
    expect((await list(a.id, 'cust_maya')).json()).toEqual({ status: 'misconfigured' })
    shop.reply(() => ({ status: 503, json: {} }))
    const res = await one(a.id, '1001', 'cust_maya')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'unavailable' })
    shop.reply(() => ({ raw: '<html>oops</html>' }))
    expect((await list(a.id, 'cust_maya')).json()).toEqual({ status: 'unavailable' })
  })

  it('reports misconfigured when the stored key cannot be decrypted', async () => {
    const a = await shopTenant('shop-a', 'a')
    await db.query(`UPDATE tenant_auth.integrations SET order_api_key_enc = 'v1:AAAA:AAAA:AAAA' WHERE tenant_id = $1`, [a.id])
    expect((await list(a.id, 'cust_maya')).json()).toEqual({ status: 'misconfigured' })
    expect(shop.requests).toHaveLength(0)
  })

  it('reports unknown and suspended tenants like agent-config', async () => {
    const missing = await list('00000000-0000-4000-8000-000000000999', 'cust_maya')
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('tenant_not_found')
    const a = await shopTenant('shop-a', 'a')
    await setTenantStatus(db, a.id, 'suspended')
    for (const res of [await list(a.id, 'cust_maya'), await one(a.id, '1001', 'cust_maya')]) {
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe('tenant_suspended')
    }
    expect(shop.requests).toHaveLength(0)
  })

  it('validates the tenant, order and customer IDs', async () => {
    const a = await shopTenant('shop-a', 'a')
    expect((await call({ method: 'GET', url: `/internal/orders/${a.id}`, headers: chatCallerHeaders() })).statusCode).toBe(400)
    expect((await list(a.id, '')).statusCode).toBe(400)
    expect((await list(a.id, 'c'.repeat(201))).statusCode).toBe(400)
    expect((await one(a.id, '1'.repeat(101), 'cust_maya')).statusCode).toBe(400)
    expect((await list('not-a-uuid', 'cust_maya')).statusCode).toBe(400)
    expect(shop.requests).toHaveLength(0)
  })

  it('accepts only the chat caller', async () => {
    const a = await shopTenant('shop-a', 'a')
    expect((await list(a.id, 'cust_maya', resolverHeaders())).statusCode).toBe(403)
    expect((await list(a.id, 'cust_maya', internalHeaders())).statusCode).toBe(403)
    expect((await list(a.id, 'cust_maya', { ...tenantAdminHeaders('00000000-0000-4000-8000-0000000000a1', a.id), 'x-internal-caller': 'gateway' })).statusCode).toBe(403)
    expect((await call({ method: 'GET', url: `/internal/orders/${a.id}?${q('cust_maya')}` })).statusCode).toBe(401)
    expect(shop.requests).toHaveLength(0)
  })
})
