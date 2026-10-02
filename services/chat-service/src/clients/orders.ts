import { HEADERS, INTERNAL_CALLER_CHAT } from '@helpix/shared'
import { parseOrder, parseOrderList, type OrderLookupResult, type OrderLookupStatus } from '@helpix/shared/orders'

export interface OrdersClient {
  /** One order of `customerId` in `tenantId`'s shop. Never throws: any failure is `{ status: 'unavailable' }`. */
  get(tenantId: string, customerId: string, orderId: string, requestId: string): Promise<OrderLookupResult>
  /** The customer's most recent orders (at most 5). Never throws. */
  list(tenantId: string, customerId: string, requestId: string): Promise<OrderLookupResult>
}

const STATUSES: ReadonlySet<string> = new Set<OrderLookupStatus>(['ok', 'not_found', 'unavailable', 'misconfigured', 'not_configured'])
// tenant-auth's own call to the shop gives up after 5 s; leave room for that and the hop.
const DEFAULT_TIMEOUT_MS = 8000

const unavailable = (): OrderLookupResult => ({ status: 'unavailable' })

/**
 * tenant-auth's `/internal/orders/*` routes (spec 4b §3.4). Only tenant-auth talks to the shop and holds its API key;
 * this client passes the tenant and the customer the request was verified for. The shopper must hear "can't check
 * right now" rather than see an error, so every failure, a suspended shop included, becomes `unavailable`.
 */
export function createOrdersClient(opts: {
  baseUrl: string
  internalToken: string
  timeoutMs?: number
  fetch?: typeof fetch
}): OrdersClient {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args))
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function call(path: string, customerId: string, requestId: string, kind: 'one' | 'list'): Promise<OrderLookupResult> {
    let res: Response
    let body: { status?: unknown; order?: unknown; orders?: unknown } | null
    try {
      res = await doFetch(`${opts.baseUrl}${path}?customerId=${encodeURIComponent(customerId)}`, {
        headers: {
          [HEADERS.internalToken]: opts.internalToken,
          [HEADERS.internalCaller]: INTERNAL_CALLER_CHAT,
          [HEADERS.requestId]: requestId,
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        return unavailable()
      }
      body = (await res.json().catch(() => null)) as typeof body
    } catch {
      return unavailable()
    }
    if (!body || typeof body.status !== 'string' || !STATUSES.has(body.status)) return unavailable()
    const status = body.status as OrderLookupStatus
    if (status !== 'ok') return { status }
    if (kind === 'one') {
      const order = parseOrder(body.order)
      return order ? { status, order } : unavailable()
    }
    const orders = parseOrderList({ orders: body.orders })
    return orders ? { status, orders } : unavailable()
  }

  return {
    get: (tenantId, customerId, orderId, requestId) =>
      call(`/internal/orders/${encodeURIComponent(tenantId)}/${encodeURIComponent(orderId)}`, customerId, requestId, 'one'),
    list: (tenantId, customerId, requestId) => call(`/internal/orders/${encodeURIComponent(tenantId)}`, customerId, requestId, 'list'),
  }
}
