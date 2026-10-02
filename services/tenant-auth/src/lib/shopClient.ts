import {
  ORDER_ID_MAX,
  ORDER_LIST_MAX,
  parseOrder,
  parseOrderList,
  type OrderLookupResult,
  type OrderLookupStatus,
} from '@helpix/shared/orders'
import { Agent, fetch as undiciFetch } from 'undici'
import { assertPublicHost, defaultLookup, guardedLookup, type LookupFn } from './baseUrl'

export type { LookupFn } from './baseUrl'

export const SHOP_TIMEOUT_MS = 5000
export const SHOP_BODY_MAX = 262_144

export interface ShopConn {
  baseUrl: string
  apiKey: string
}

export interface ShopClient {
  getOrder(c: ShopConn, customerId: string, orderId: string): Promise<OrderLookupResult>
  listOrders(c: ShopConn, customerId: string, limit?: number): Promise<OrderLookupResult & { httpStatus?: number }>
}

type Fetched =
  | { status: 'ok'; body: unknown; httpStatus: number }
  | { status: Exclude<OrderLookupStatus, 'ok' | 'not_configured'>; httpStatus?: number }

/** The body as text, or null when it is over `max` bytes or could not be read (e.g. timed out mid-body). */
async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {})
    return null
  }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > max) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/**
 * Calls a shop's order API (4b spec §3.3). Never throws: every failure is a lookup status.
 * The API key goes only into the Authorization header; it is never logged or returned.
 */
export function createShopClient(opts: {
  allowPrivateHosts: boolean
  timeoutMs?: number
  fetch?: typeof fetch
  lookup?: LookupFn
}): ShopClient {
  const timeoutMs = opts.timeoutMs ?? SHOP_TIMEOUT_MS
  const lookup = opts.lookup ?? defaultLookup
  // Public-only mode connects through a guarded lookup, so the connected address is the checked one.
  const guarded = opts.allowPrivateHosts ? undefined : new Agent({ connect: { lookup: guardedLookup(lookup) as never } })
  const doFetch: typeof fetch =
    opts.fetch ??
    (guarded
      ? (((url: string, init: RequestInit) => undiciFetch(url, { ...init, dispatcher: guarded } as never)) as unknown as typeof fetch)
      : (...args) => globalThis.fetch(...args))

  async function get(c: ShopConn, customerId: string, path: string): Promise<Fetched> {
    try {
      await assertPublicHost(c.baseUrl, opts.allowPrivateHosts, lookup)
    } catch {
      return { status: 'unavailable' }
    }
    const signal = AbortSignal.timeout(timeoutMs)
    let res: Response
    try {
      res = await doFetch(`${c.baseUrl}${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${c.apiKey}`, 'X-Customer-Id': customerId, Accept: 'application/json' },
        redirect: 'manual',
        signal,
      })
    } catch {
      return { status: 'unavailable' }
    }
    const httpStatus = res.status
    if (httpStatus !== 200) {
      await res.body?.cancel().catch(() => {})
      if (httpStatus === 404) return { status: 'not_found', httpStatus }
      if (httpStatus === 401 || httpStatus === 403) return { status: 'misconfigured', httpStatus }
      return { status: 'unavailable', httpStatus }
    }
    const text = await readCapped(res, SHOP_BODY_MAX)
    if (text === null) return { status: 'unavailable', httpStatus }
    try {
      return { status: 'ok', body: JSON.parse(text) as unknown, httpStatus }
    } catch {
      return { status: 'unavailable', httpStatus }
    }
  }

  return {
    async getOrder(c, customerId, orderId) {
      // '.' and '..' would be collapsed out of the URL path by the URL parser.
      if (orderId.length < 1 || orderId.length > ORDER_ID_MAX || orderId === '.' || orderId === '..') return { status: 'not_found' }
      const r = await get(c, customerId, `/orders/${encodeURIComponent(orderId)}`)
      if (r.status !== 'ok') return { status: r.status }
      const order = parseOrder(r.body)
      return order ? { status: 'ok', order } : { status: 'unavailable' }
    },

    async listOrders(c, customerId, limit = ORDER_LIST_MAX) {
      const n = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), ORDER_LIST_MAX) : ORDER_LIST_MAX
      const r = await get(c, customerId, `/orders?limit=${n}`)
      if (r.status !== 'ok') return r.httpStatus === undefined ? { status: r.status } : { status: r.status, httpStatus: r.httpStatus }
      const orders = parseOrderList(r.body)
      return orders ? { status: 'ok', orders: orders.slice(0, n), httpStatus: r.httpStatus } : { status: 'unavailable', httpStatus: r.httpStatus }
    },
  }
}
