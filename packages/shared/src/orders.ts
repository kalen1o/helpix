// Pure TypeScript with no Node imports: the widget and dashboard import it through `@helpix/shared/orders`.
// The order contract a shop's order API must return (parent spec §3.5, 4b spec §3.3).

export const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export interface OrderItem {
  name: string
  quantity: number
  variant?: string
}

export interface OrderTracking {
  carrier: string
  number: string
  url?: string
}

export interface Order {
  orderId: string
  status: OrderStatus
  placedAt: string
  updatedAt: string
  items: OrderItem[]
  eta?: string
  tracking?: OrderTracking
  note?: string
}

/** The most orders Helpix ever asks for or keeps from one list call. */
export const ORDER_LIST_MAX = 5
export const ORDER_ID_MAX = 100
export const ORDER_ITEMS_MAX = 50
const TEXT_MAX = 200
const NOTE_MAX = 500
const URL_MAX = 500
const QUANTITY_MAX = 10_000

export type OrderLookupStatus = 'ok' | 'not_found' | 'unavailable' | 'misconfigured' | 'not_configured'

export interface OrderLookupResult {
  status: OrderLookupStatus
  order?: Order
  orders?: Order[]
}

type Obj = Record<string, unknown>
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const absent = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

/** A trimmed, non-empty string, truncated to `max`; null otherwise. */
function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

const ISO = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/

function isoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return ISO.test(s) && !Number.isNaN(Date.parse(s)) ? s : null
}

function orderIdOf(v: unknown): string | null {
  let s = ''
  if (typeof v === 'string') s = v.trim()
  else if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) s = String(v)
  return s.length >= 1 && s.length <= ORDER_ID_MAX ? s : null
}

function httpUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (s.length > URL_MAX) return null
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:' ? s : null
  } catch {
    return null
  }
}

function parseItem(v: unknown): OrderItem | null {
  if (!isObject(v)) return null
  const name = text(v.name, TEXT_MAX)
  const quantity = v.quantity
  if (!name || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > QUANTITY_MAX) return null
  const item: OrderItem = { name, quantity }
  if (!absent(v.variant)) {
    const variant = text(v.variant, TEXT_MAX)
    if (!variant) return null
    item.variant = variant
  }
  return item
}

function parseTracking(v: unknown): OrderTracking | null {
  if (!isObject(v)) return null
  const carrier = text(v.carrier, TEXT_MAX)
  const number = text(v.number, TEXT_MAX)
  if (!carrier || !number) return null
  const tracking: OrderTracking = { carrier, number }
  if (!absent(v.url)) {
    const url = httpUrl(v.url)
    if (!url) return null
    tracking.url = url
  }
  return tracking
}

/** Returns a cleaned Order (only contract fields, strings trimmed/capped) or null when `v` does not match the contract. */
export function parseOrder(v: unknown): Order | null {
  if (!isObject(v)) return null
  const orderId = orderIdOf(v.orderId)
  const status =
    typeof v.status === 'string' && (ORDER_STATUSES as readonly string[]).includes(v.status) ? (v.status as OrderStatus) : null
  const placedAt = isoDate(v.placedAt)
  const updatedAt = isoDate(v.updatedAt)
  if (!orderId || !status || !placedAt || !updatedAt) return null

  const rawItems = v.items
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > ORDER_ITEMS_MAX) return null
  const items: OrderItem[] = []
  for (const raw of rawItems) {
    const item = parseItem(raw)
    if (!item) return null
    items.push(item)
  }

  const order: Order = { orderId, status, placedAt, updatedAt, items }
  if (!absent(v.eta)) {
    const eta = isoDate(v.eta)
    if (!eta) return null
    order.eta = eta
  }
  if (!absent(v.tracking)) {
    const tracking = parseTracking(v.tracking)
    if (!tracking) return null
    order.tracking = tracking
  }
  if (!absent(v.note)) {
    const note = text(v.note, NOTE_MAX)
    if (!note) return null
    order.note = note
  }
  return order
}

/** `{ orders: Order[] }` → at most ORDER_LIST_MAX parsed orders, or null if the shape or any order is invalid. */
export function parseOrderList(v: unknown): Order[] | null {
  if (!isObject(v)) return null
  const raw = v.orders
  if (!Array.isArray(raw)) return null
  const orders: Order[] = []
  for (const o of raw.slice(0, ORDER_LIST_MAX)) {
    const parsed = parseOrder(o)
    if (!parsed) return null
    orders.push(parsed)
  }
  return orders
}
