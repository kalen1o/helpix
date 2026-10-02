import type { FastifyInstance, InjectOptions } from 'fastify'
import { generateKeyPairSync } from 'node:crypto'
import { HEADERS, type Db } from '@helpix/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { decryptSecret } from '../src/lib/secrets'
import { createShopClient } from '../src/lib/shopClient'
import { getIntegrations } from '../src/repos/integrations'
import { SAMPLE_ORDER, startFakeShop, type FakeShop } from './fakeShop'
import {
  buildTestApp,
  chatCallerHeaders,
  internalHeaders,
  newShopKeyPair,
  resetDb,
  seedTenant,
  setupTestDb,
  superAdminHeaders,
  tenantAdminHeaders,
  TEST_CONFIG,
} from './helpers'

let db: Db
let app: FastifyInstance
let shop: FakeShop
let pemA: string
let pemB: string
const extraApps: FastifyInstance[] = []
const bodies: string[] = []
const KEY = 'sk_test_orchard_0123456789'
const KEY2 = 'sk_test_rotated_9876543210'
const ADMIN = '00000000-0000-4000-8000-0000000000a1'

beforeAll(async () => {
  db = await setupTestDb()
  shop = await startFakeShop()
  pemA = (await newShopKeyPair()).publicPem
  pemB = (await newShopKeyPair()).publicPem
})
afterAll(async () => {
  await shop.close()
  await db.end()
})
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(db)
  shop.requests.length = 0
  shop.reply(() => ({ json: { orders: [SAMPLE_ORDER] } }))
  bodies.length = 0
})
afterEach(async () => {
  await app.close()
  for (const extra of extraApps.splice(0)) await extra.close()
  // The plain order API key must never appear in any response body.
  for (const body of bodies) {
    expect(body).not.toContain(KEY)
    expect(body).not.toContain(KEY2)
  }
})

async function call(opts: InjectOptions, on: FastifyInstance = app) {
  const res = await on.inject(opts)
  bodies.push(res.body)
  return res
}
async function tenant(slug: string) {
  const t = await seedTenant(db, { slug })
  return { id: t.id, headers: tenantAdminHeaders(ADMIN, t.id) }
}
type H = Record<string, string>
const getView = (headers: H) => call({ method: 'GET', url: '/integrations', headers })
const putOrderApi = (headers: H, payload: Record<string, unknown>, on?: FastifyInstance) =>
  call({ method: 'PUT', url: '/integrations/order-api', headers, payload }, on)
const deleteOrderApi = (headers: H) => call({ method: 'DELETE', url: '/integrations/order-api', headers })
const testConnection = (headers: H, customerId = 'cust_maya', on?: FastifyInstance) =>
  call({ method: 'POST', url: '/integrations/order-api/test', headers, payload: { customerId } }, on)
const putShopKey = (headers: H, publicKeyPem: string) => call({ method: 'PUT', url: '/integrations/shop-key', headers, payload: { publicKeyPem } })
const deleteShopKey = (headers: H) => call({ method: 'DELETE', url: '/integrations/shop-key', headers })

describe('order API settings', () => {
  it('starts empty', async () => {
    const a = await tenant('shop-a')
    const res = await getView(a.headers)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ orderApi: null, shopKey: null })
  })

  it('saves a normalized URL and an encrypted key, and returns only hasApiKey', async () => {
    const a = await tenant('shop-a')
    const res = await putOrderApi(a.headers, { baseUrl: ` ${shop.url}/api/ `, apiKey: `  ${KEY}\n` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      orderApi: { baseUrl: `${shop.url}/api`, hasApiKey: true, updatedAt: expect.any(String) },
      shopKey: null,
    })
    const row = await getIntegrations(db, a.id)
    expect(row!.order_api_key_enc).toMatch(/^v1:/)
    expect(row!.order_api_key_enc).not.toContain(KEY)
    expect(decryptSecret(row!.order_api_key_enc!, TEST_CONFIG.secretsMasterKey)).toBe(KEY)
    expect((await getView(a.headers)).json().orderApi.baseUrl).toBe(`${shop.url}/api`)
  })

  it('keeps the stored key when apiKey is omitted, and replaces it when given', async () => {
    const a = await tenant('shop-a')
    await putOrderApi(a.headers, { baseUrl: `${shop.url}/old`, apiKey: KEY })
    expect((await putOrderApi(a.headers, { baseUrl: `${shop.url}/new` })).json().orderApi).toMatchObject({ baseUrl: `${shop.url}/new`, hasApiKey: true })
    expect(decryptSecret((await getIntegrations(db, a.id))!.order_api_key_enc!, TEST_CONFIG.secretsMasterKey)).toBe(KEY)
    await putOrderApi(a.headers, { baseUrl: `${shop.url}/new`, apiKey: KEY2 })
    expect(decryptSecret((await getIntegrations(db, a.id))!.order_api_key_enc!, TEST_CONFIG.secretsMasterKey)).toBe(KEY2)
  })

  it('requires the API key again when the base URL moves to another origin', async () => {
    const a = await tenant('shop-a')
    await putOrderApi(a.headers, { baseUrl: `${shop.url}/api`, apiKey: KEY })
    const port = new URL(shop.url).port
    for (const baseUrl of ['https://evil.example', `https://127.0.0.1:${port}/api`, `http://localhost:${port}/api`, `http://127.0.0.1:1/api`]) {
      const res = await putOrderApi(a.headers, { baseUrl })
      expect(res.statusCode, baseUrl).toBe(400)
      expect(res.json().error).toMatchObject({ code: 'api_key_required', message: 'Enter the API key again when changing the order API host.' })
    }
    const row = await getIntegrations(db, a.id)
    expect(row!.order_api_base_url).toBe(`${shop.url}/api`)
    expect(decryptSecret(row!.order_api_key_enc!, TEST_CONFIG.secretsMasterKey)).toBe(KEY)
    expect(shop.requests).toEqual([])
    // With the key, the move is allowed; on the same origin a path change keeps the key.
    expect((await putOrderApi(a.headers, { baseUrl: 'https://evil.example', apiKey: KEY2 })).statusCode).toBe(200)
    expect((await putOrderApi(a.headers, { baseUrl: 'https://EVIL.example:443/v2/' })).json().orderApi).toMatchObject({
      baseUrl: 'https://evil.example/v2',
      hasApiKey: true,
    })
    expect(decryptSecret((await getIntegrations(db, a.id))!.order_api_key_enc!, TEST_CONFIG.secretsMasterKey)).toBe(KEY2)
  })

  it('requires an API key when none is stored', async () => {
    const a = await tenant('shop-a')
    const res = await putOrderApi(a.headers, { baseUrl: `${shop.url}/api` })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('api_key_required')
    expect((await getView(a.headers)).json().orderApi).toBeNull()
  })

  it.each([
    ['ftp', { baseUrl: 'ftp://shop.example', apiKey: KEY }, 'invalid_base_url'],
    ['credentials', { baseUrl: 'https://u:p@shop.example', apiKey: KEY }, 'invalid_base_url'],
    ['a query string', { baseUrl: 'https://shop.example/api?x=1', apiKey: KEY }, 'invalid_base_url'],
    ['a fragment', { baseUrl: 'https://shop.example/api#x', apiKey: KEY }, 'invalid_base_url'],
    ['a relative URL', { baseUrl: 'shop.example/api', apiKey: KEY }, 'invalid_base_url'],
    ['a URL over 500 characters', { baseUrl: `https://shop.example/${'a'.repeat(490)}`, apiKey: KEY }, 'validation_error'],
    ['a 7-character key', { baseUrl: 'https://shop.example', apiKey: '1234567' }, 'validation_error'],
    ['a key that is short once trimmed', { baseUrl: 'https://shop.example', apiKey: '   1234   ' }, 'invalid_api_key'],
    ['a 501-character key', { baseUrl: 'https://shop.example', apiKey: 'k'.repeat(501) }, 'validation_error'],
    ['a missing baseUrl', { apiKey: KEY }, 'validation_error'],
  ])('rejects %s', async (_label, payload, code) => {
    const a = await tenant('shop-a')
    const res = await putOrderApi(a.headers, payload)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(code)
  })

  it('rejects URLs pointing inside Helpix when private hosts are disallowed', async () => {
    const strict = await buildTestApp(db, { config: { orderApiAllowPrivateHosts: false } })
    extraApps.push(strict)
    const a = await tenant('shop-a')
    for (const baseUrl of ['http://localhost:4001', 'https://169.254.169.254/latest', 'https://127.0.0.1:4001', 'https://[::1]:4002', 'https://10.0.0.8']) {
      const res = await putOrderApi(a.headers, { baseUrl, apiKey: KEY }, strict)
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('invalid_base_url')
    }
    expect(await getIntegrations(db, a.id)).toBeNull()
  })

  it('removes the order API and keeps the shop key', async () => {
    const a = await tenant('shop-a')
    await putShopKey(a.headers, pemA)
    await putOrderApi(a.headers, { baseUrl: `${shop.url}/api`, apiKey: KEY })
    const res = await deleteOrderApi(a.headers)
    expect(res.statusCode).toBe(204)
    expect((await getView(a.headers)).json()).toEqual({ orderApi: null, shopKey: { fingerprint: expect.any(String), updatedAt: expect.any(String) } })
    expect((await deleteOrderApi(a.headers)).statusCode).toBe(204)
  })
})

describe('POST /integrations/order-api/test', () => {
  async function configured() {
    const a = await tenant('shop-a')
    await putOrderApi(a.headers, { baseUrl: `${shop.url}/api`, apiKey: KEY })
    return a
  }

  it('calls GET /orders?limit=1 as the test customer and reports success', async () => {
    const a = await configured()
    const res = await testConnection(a.headers, 'cust_maya')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, status: 'ok', message: 'Connected. The shop returned an order for this customer.' })
    expect(shop.requests).toEqual([
      { path: '/api/orders', query: '?limit=1', authorization: `Bearer ${KEY}`, customerId: 'cust_maya', accept: 'application/json' },
    ])
  })

  it('reports a customer with no orders as connected', async () => {
    const a = await configured()
    shop.reply(() => ({ json: { orders: [] } }))
    expect((await testConnection(a.headers)).json()).toEqual({ ok: true, status: 'ok', message: 'Connected. This customer has no orders yet.' })
  })

  it.each([
    [{ status: 401, json: {} }, { ok: false, status: 'misconfigured', message: 'The shop rejected the API key (401)' }],
    [{ status: 403, json: {} }, { ok: false, status: 'misconfigured', message: 'The shop rejected the API key (403)' }],
    [{ status: 404, json: {} }, { ok: false, status: 'not_found', message: "The shop's order API answered 404. Check the base URL." }],
    [{ status: 500, json: {} }, { ok: false, status: 'unavailable', message: "The shop's order API returned an error (500)" }],
    [{ status: 301, location: '/elsewhere' }, { ok: false, status: 'unavailable', message: "The shop's order API redirected (301). Use the final URL as the base URL." }],
    [{ json: { orders: [{ orderId: '1' }] } }, { ok: false, status: 'unavailable', message: "The response didn't match the order format" }],
    [{ raw: '<html>Sign in</html>' }, { ok: false, status: 'unavailable', message: "The response didn't match the order format" }],
  ])('explains shop reply %j', async (reply, expected) => {
    const a = await configured()
    shop.reply(() => reply)
    expect((await testConnection(a.headers)).json()).toEqual(expected)
  })

  it('explains a timeout', async () => {
    const slow = await buildTestApp(db, { shop: createShopClient({ allowPrivateHosts: true, timeoutMs: 100 }) })
    extraApps.push(slow)
    const a = await configured()
    shop.reply(() => ({ delayMs: 400, json: { orders: [] } }))
    expect((await testConnection(a.headers, 'cust_maya', slow)).json()).toEqual({
      ok: false,
      status: 'unavailable',
      message: "The shop's order API timed out or is unreachable",
    })
  })

  it('says to save settings first when nothing is configured', async () => {
    const a = await tenant('shop-a')
    expect((await testConnection(a.headers)).json()).toEqual({ ok: false, status: 'not_configured', message: 'Save the order API URL and key first.' })
    expect(shop.requests).toHaveLength(0)
  })

  it('validates the test customer ID', async () => {
    const a = await configured()
    expect((await testConnection(a.headers, '')).statusCode).toBe(400)
    expect((await testConnection(a.headers, 'c'.repeat(201))).statusCode).toBe(400)
  })
})

describe('shop sign-in key', () => {
  it('saves, replaces and removes the key, returning only its fingerprint', async () => {
    const a = await tenant('shop-a')
    const first = await putShopKey(a.headers, pemA)
    expect(first.statusCode).toBe(200)
    const fpA = first.json().shopKey.fingerprint as string
    expect(fpA).toMatch(/^([0-9a-f]{2}:){31}[0-9a-f]{2}$/)
    expect(first.body).not.toContain('BEGIN PUBLIC KEY')
    const second = await putShopKey(a.headers, pemB)
    expect(second.json().shopKey.fingerprint).not.toBe(fpA)
    expect((await deleteShopKey(a.headers)).statusCode).toBe(204)
    expect((await getView(a.headers)).json().shopKey).toBeNull()
  })

  it('rejects a weak, non-RSA, private or oversized key', async () => {
    const a = await tenant('shop-a')
    const weak = String(generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' }))
    const ec = String(generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' }))
    const priv = String(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }))
    for (const pem of [weak, ec, priv, 'hello']) {
      const res = await putShopKey(a.headers, pem)
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('invalid_public_key')
    }
    expect((await putShopKey(a.headers, 'A'.repeat(10_241))).statusCode).toBe(400)
    expect((await getView(a.headers)).json().shopKey).toBeNull()
  })
})

describe('access and isolation', () => {
  it('is for tenant admins only', async () => {
    await tenant('shop-a')
    for (const headers of [superAdminHeaders(ADMIN), internalHeaders(), chatCallerHeaders()]) {
      expect((await getView(headers)).statusCode).toBe(403)
      expect((await putOrderApi(headers, { nonsense: true })).statusCode).toBe(403)
      expect((await putShopKey(headers, pemA)).statusCode).toBe(403)
      expect((await testConnection(headers)).statusCode).toBe(403)
    }
  })

  it("never shows or changes another tenant's integrations, and ignores a tenantId in the body", async () => {
    const a = await tenant('shop-a')
    const b = await tenant('shop-b')
    await putOrderApi(a.headers, { baseUrl: `${shop.url}/a`, apiKey: KEY, tenantId: b.id })
    await putShopKey(a.headers, pemA)
    expect((await getView(b.headers)).json()).toEqual({ orderApi: null, shopKey: null })
    expect((await deleteOrderApi(b.headers)).statusCode).toBe(204)
    expect((await deleteShopKey(b.headers)).statusCode).toBe(204)
    expect((await getView(a.headers)).json().orderApi).toMatchObject({ baseUrl: `${shop.url}/a`, hasApiKey: true })
    expect((await getView(a.headers)).json().shopKey).not.toBeNull()
    expect((await testConnection(b.headers)).json().status).toBe('not_configured')
    expect(shop.requests).toHaveLength(0)
  })
})

describe('orderLookup flag', () => {
  it('follows the order API config in agent-config and widget config', async () => {
    const a = await tenant('shop-a')
    const agentConfig = () => call({ method: 'GET', url: `/internal/agent-config/${a.id}`, headers: chatCallerHeaders() })
    const widgetConfig = () => call({ method: 'GET', url: '/widget/config', headers: { ...internalHeaders(), [HEADERS.tenantId]: a.id } })
    expect((await agentConfig()).json().orderLookup).toBe(false)
    expect((await widgetConfig()).json().orderLookup).toBe(false)
    await putShopKey(a.headers, pemA)
    expect((await agentConfig()).json().orderLookup).toBe(false)
    await putOrderApi(a.headers, { baseUrl: `${shop.url}/api`, apiKey: KEY })
    expect((await agentConfig()).json().orderLookup).toBe(true)
    expect((await widgetConfig()).json().orderLookup).toBe(true)
    await deleteOrderApi(a.headers)
    expect((await agentConfig()).json().orderLookup).toBe(false)
    expect((await widgetConfig()).json().orderLookup).toBe(false)
  })
})
