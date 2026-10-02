import { describe, expect, it, vi } from 'vitest'
import { createOrdersClient } from '../src/clients/orders'
import { ORDER, ORDER_2 } from './helpers'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function fakeFetch(reply: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return reply(String(url), init)
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const client = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
  createOrdersClient({ baseUrl: 'http://ta.test', internalToken: 'tok', fetch, ...(timeoutMs ? { timeoutMs } : {}) })

describe('createOrdersClient', () => {
  it('gets one order as the chat caller, with the customer in the query', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { status: 'ok', order: ORDER }))
    expect(await client(fetch).get('tenant-a', 'cust maya/1', 'A#1', 'req-1')).toEqual({ status: 'ok', order: ORDER })
    expect(calls[0]!.url).toBe('http://ta.test/internal/orders/tenant-a/A%231?customerId=cust%20maya%2F1')
    expect(calls[0]!.init.method ?? 'GET').toBe('GET')
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get('x-internal-token')).toBe('tok')
    expect(headers.get('x-internal-caller')).toBe('chat')
    expect(headers.get('x-request-id')).toBe('req-1')
  })

  it("lists the customer's recent orders", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { status: 'ok', orders: [ORDER, ORDER_2] }))
    expect(await client(fetch).list('tenant-a', 'cust_maya', 'req-2')).toEqual({ status: 'ok', orders: [ORDER, ORDER_2] })
    expect(calls[0]!.url).toBe('http://ta.test/internal/orders/tenant-a?customerId=cust_maya')
  })

  it.each(['not_found', 'unavailable', 'misconfigured', 'not_configured'] as const)('passes %s through', async (status) => {
    const { fetch } = fakeFetch(() => json(200, { status }))
    expect(await client(fetch).get('t', 'c', '1', 'r')).toEqual({ status })
    expect(await client(fetch).list('t', 'c', 'r')).toEqual({ status })
  })

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
    ['a 500', () => json(500, { error: { code: 'internal_error' } })],
    ['a suspended shop (403 tenant_suspended)', () => json(403, { error: { code: 'tenant_suspended' } })],
    ['a 400', () => json(400, { error: { code: 'validation_error' } })],
    ['a body that is not JSON', () => new Response('<html>oops</html>', { status: 200 })],
    ['an unknown status', () => json(200, { status: 'great' })],
    ['ok without a valid order', () => json(200, { status: 'ok', order: { orderId: 1 } })],
  ])('turns %s into unavailable', async (_label, reply) => {
    expect(await client(fakeFetch(reply).fetch).get('t', 'c', '1', 'r')).toEqual({ status: 'unavailable' })
  })

  it('turns an ok list that is not a list into unavailable', async () => {
    expect(await client(fakeFetch(() => json(200, { status: 'ok', orders: 'nope' })).fetch).list('t', 'c', 'r')).toEqual({ status: 'unavailable' })
  })

  it('gives up after the timeout', async () => {
    const { fetch } = fakeFetch(
      (_url, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
    )
    expect(await client(fetch, 20).list('t', 'c', 'r')).toEqual({ status: 'unavailable' })
  })
})
