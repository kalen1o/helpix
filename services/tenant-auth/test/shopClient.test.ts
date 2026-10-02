import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createShopClient, SHOP_BODY_MAX, type ShopConn } from '../src/lib/shopClient'
import { SAMPLE_ORDER, startFakeShop, type FakeShop } from './fakeShop'

let shop: FakeShop
let conn: ShopConn
const KEY = 'sk_test_orchard_0123456789'

beforeAll(async () => {
  shop = await startFakeShop()
  conn = { baseUrl: `${shop.url}/api`, apiKey: KEY }
})
afterAll(async () => { await shop.close() })
beforeEach(() => {
  shop.requests.length = 0
  shop.reply(() => ({ status: 404, json: {} }))
})

const client = createShopClient({ allowPrivateHosts: true })

describe('shop client against a real HTTP shop', () => {
  it('gets one order with the key, customer and Accept headers, URL-encoding the id', async () => {
    shop.reply(() => ({ json: { ...SAMPLE_ORDER, orderId: 'A 1?x', internalCost: 12 } }))
    const res = await client.getOrder(conn, 'cust_maya', 'A 1?x')
    expect(res).toEqual({ status: 'ok', order: { ...SAMPLE_ORDER, orderId: 'A 1?x' } })
    expect(shop.requests).toEqual([
      { path: '/api/orders/A%201%3Fx', query: '', authorization: `Bearer ${KEY}`, customerId: 'cust_maya', accept: 'application/json' },
    ])
  })

  it('lists orders, asks for limit=5 by default and caps the result at 5', async () => {
    const orders = Array.from({ length: 7 }, (_, i) => ({ ...SAMPLE_ORDER, orderId: String(1001 + i) }))
    shop.reply(() => ({ json: { orders } }))
    const res = await client.listOrders(conn, 'cust_maya')
    expect(res.status).toBe('ok')
    expect(res.httpStatus).toBe(200)
    expect(res.orders!.map((o) => o.orderId)).toEqual(['1001', '1002', '1003', '1004', '1005'])
    expect(shop.requests[0]).toMatchObject({ path: '/api/orders', query: '?limit=5', customerId: 'cust_maya' })
  })

  it('passes a smaller limit through and keeps at most that many', async () => {
    shop.reply(() => ({ json: { orders: [SAMPLE_ORDER, { ...SAMPLE_ORDER, orderId: '1002' }] } }))
    const res = await client.listOrders(conn, 'cust_maya', 1)
    expect(res.orders).toHaveLength(1)
    expect(shop.requests[0]!.query).toBe('?limit=1')
    await client.listOrders(conn, 'cust_maya', 50)
    expect(shop.requests[1]!.query).toBe('?limit=5')
  })

  it('returns an empty list as ok', async () => {
    shop.reply(() => ({ json: { orders: [] } }))
    expect(await client.listOrders(conn, 'cust_new')).toEqual({ status: 'ok', orders: [], httpStatus: 200 })
  })

  it('maps 404 to not_found', async () => {
    shop.reply(() => ({ status: 404, json: { error: 'no such order' } }))
    expect(await client.getOrder(conn, 'cust_maya', '9999')).toEqual({ status: 'not_found' })
    expect(await client.listOrders(conn, 'cust_maya')).toEqual({ status: 'not_found', httpStatus: 404 })
  })

  it.each([401, 403])('maps %i to misconfigured', async (status) => {
    shop.reply(() => ({ status, json: { error: 'bad key' } }))
    expect(await client.getOrder(conn, 'cust_maya', '1001')).toEqual({ status: 'misconfigured' })
    expect(await client.listOrders(conn, 'cust_maya')).toEqual({ status: 'misconfigured', httpStatus: status })
  })

  it.each([500, 502, 503, 400, 429, 204])('maps %i to unavailable', async (status) => {
    shop.reply(() => ({ status, json: { orders: [SAMPLE_ORDER] } }))
    expect(await client.getOrder(conn, 'cust_maya', '1001')).toEqual({ status: 'unavailable' })
    expect(await client.listOrders(conn, 'cust_maya')).toEqual({ status: 'unavailable', httpStatus: status })
  })

  it('does not follow redirects: a 3xx is unavailable and only one request is made', async () => {
    shop.reply((r) => (r.path.endsWith('/orders') ? { status: 302, location: `${shop.url}/elsewhere/orders` } : { json: { orders: [SAMPLE_ORDER] } }))
    expect(await client.listOrders(conn, 'cust_maya')).toEqual({ status: 'unavailable', httpStatus: 302 })
    expect(shop.requests).toHaveLength(1)
  })

  it('treats a timeout as unavailable', async () => {
    const slow = createShopClient({ allowPrivateHosts: true, timeoutMs: 100 })
    shop.reply(() => ({ delayMs: 400, json: { orders: [SAMPLE_ORDER] } }))
    const started = Date.now()
    expect(await slow.listOrders(conn, 'cust_maya')).toEqual({ status: 'unavailable' })
    expect(Date.now() - started).toBeLessThan(350)
  })

  it('treats a network error as unavailable', async () => {
    const dead = { baseUrl: 'http://127.0.0.1:1', apiKey: KEY }
    expect(await client.getOrder(dead, 'cust_maya', '1001')).toEqual({ status: 'unavailable' })
  })

  it('treats HTML or invalid JSON as unavailable', async () => {
    shop.reply(() => ({ raw: '<html><body>Login</body></html>' }))
    expect(await client.getOrder(conn, 'cust_maya', '1001')).toEqual({ status: 'unavailable' })
    shop.reply(() => ({ raw: '{"orders": [', contentType: 'application/json' }))
    expect(await client.listOrders(conn, 'cust_maya')).toEqual({ status: 'unavailable', httpStatus: 200 })
  })

  it('treats a body that does not match the order contract as unavailable', async () => {
    shop.reply(() => ({ json: { ...SAMPLE_ORDER, status: 'teleported' } }))
    expect(await client.getOrder(conn, 'cust_maya', '1001')).toEqual({ status: 'unavailable' })
    shop.reply(() => ({ json: [SAMPLE_ORDER] }))
    expect(await client.listOrders(conn, 'cust_maya')).toEqual({ status: 'unavailable', httpStatus: 200 })
  })

  it('rejects an oversized body, with or without content-length', async () => {
    const pad = 'x'.repeat(SHOP_BODY_MAX)
    shop.reply(() => ({ raw: JSON.stringify({ orders: [SAMPLE_ORDER], pad }), contentType: 'application/json' }))
    expect(await client.listOrders(conn, 'cust_maya')).toEqual({ status: 'unavailable', httpStatus: 200 })
    shop.reply(() => ({ chunks: ['{"orders":[],"pad":"', ...Array.from({ length: 30 }, () => 'x'.repeat(10_000)), '"}'] }))
    expect(await client.listOrders(conn, 'cust_maya')).toEqual({ status: 'unavailable', httpStatus: 200 })
  })

  it('does not call the shop for an order id outside 1–100 characters', async () => {
    expect(await client.getOrder(conn, 'cust_maya', '')).toEqual({ status: 'not_found' })
    expect(await client.getOrder(conn, 'cust_maya', '1'.repeat(101))).toEqual({ status: 'not_found' })
    expect(await client.getOrder(conn, 'cust_maya', '.')).toEqual({ status: 'not_found' })
    expect(await client.getOrder(conn, 'cust_maya', '..')).toEqual({ status: 'not_found' })
    expect(shop.requests).toHaveLength(0)
  })
})

describe('private address blocking', () => {
  it('blocks private addresses unless allowed', async () => {
    shop.reply(() => ({ json: { orders: [SAMPLE_ORDER] } }))
    const strict = createShopClient({ allowPrivateHosts: false })
    // The fake shop is http://127.0.0.1: refused before any request leaves.
    expect(await strict.listOrders(conn, 'cust_maya')).toEqual({ status: 'unavailable' })
    expect(await strict.getOrder(conn, 'cust_maya', '1001')).toEqual({ status: 'unavailable' })
    expect(shop.requests).toHaveLength(0)

    // https to a name that resolves privately (e.g. DNS pointing at Helpix's own network): never fetched.
    const fetchSpy = vi.fn(async () => new Response('{}'))
    const rebound = createShopClient({
      allowPrivateHosts: false,
      fetch: fetchSpy as unknown as typeof fetch,
      lookup: async () => [{ address: '10.0.0.5', family: 4 }],
    })
    expect(await rebound.listOrders({ baseUrl: 'https://shop.example', apiKey: KEY }, 'cust_maya')).toEqual({ status: 'unavailable' })
    expect(fetchSpy).not.toHaveBeenCalled()

    // The same client with allowPrivateHosts reaches the local shop.
    expect((await client.listOrders(conn, 'cust_maya')).status).toBe('ok')
    expect(shop.requests).toHaveLength(1)
  })

  it('calls a public host (checked at every call) with the manual-redirect fetch', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ orders: [SAMPLE_ORDER] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const pub = createShopClient({ allowPrivateHosts: false, fetch: fetchSpy as unknown as typeof fetch, lookup })
    const target = { baseUrl: 'https://shop.example/api', apiKey: KEY }
    expect((await pub.listOrders(target, 'cust_maya', 2)).status).toBe('ok')
    expect((await pub.listOrders(target, 'cust_maya', 2)).status).toBe('ok')
    expect(lookup).toHaveBeenCalledTimes(2)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://shop.example/api/orders?limit=2')
    expect(init.redirect).toBe('manual')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${KEY}`)
  })

  it('refuses a host whose connect-time DNS answer is private (rebinding), without any request', async () => {
    shop.reply(() => ({ json: { orders: [SAMPLE_ORDER] } }))
    let calls = 0
    const lookup = async () => (++calls === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }])
    const rebinding = createShopClient({ allowPrivateHosts: false, lookup })
    const port = new URL(shop.url).port
    const res = await rebinding.listOrders({ baseUrl: `https://shop.test:${port}`, apiKey: KEY }, 'cust_maya')
    expect(res).toEqual({ status: 'unavailable' })
    expect(calls).toBe(2)
    expect(shop.requests).toHaveLength(0)
  })
})
