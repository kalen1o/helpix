import { describe, expect, it } from 'vitest'
import { ORDER_LIST_MAX, ORDER_STATUSES, parseOrder, parseOrderList } from '../src/orders'

const VALID = {
  orderId: '1001',
  status: 'shipped',
  placedAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-22T08:30:00Z',
  items: [{ name: 'iPhone 15', quantity: 1, variant: 'Blue · 128 GB' }],
  eta: '2026-09-25',
  tracking: { carrier: 'UPS', number: '1Z999', url: 'https://ups.example/track/1Z999' },
  note: 'Left at the front desk',
}

describe('parseOrder', () => {
  it('returns a cleaned order with only contract fields', () => {
    const parsed = parseOrder({
      ...VALID,
      orderId: '  1001 ',
      internalMargin: 0.42,
      customerEmail: 'maya@orchard.demo',
      items: [{ name: '  iPhone 15  ', quantity: 1, variant: 'Blue · 128 GB', sku: 'IP15-BL-128', cost: 500 }],
      tracking: { ...VALID.tracking, warehouse: 'W3' },
    })
    expect(parsed).toEqual(VALID)
  })

  it('accepts a minimal order and treats null or blank optional fields as absent', () => {
    const minimal = { orderId: 'A-1', status: 'processing', placedAt: '2026-10-01', updatedAt: '2026-10-01T09:00', items: [{ name: 'Case', quantity: 2 }] }
    expect(parseOrder(minimal)).toEqual(minimal)
    expect(parseOrder({ ...minimal, eta: null, tracking: null, note: '   ', items: [{ name: 'Case', quantity: 2, variant: '' }] })).toEqual(minimal)
  })

  it('accepts every status and a numeric order id', () => {
    for (const status of ORDER_STATUSES) expect(parseOrder({ ...VALID, status })?.status).toBe(status)
    expect(parseOrder({ ...VALID, orderId: 1047 })?.orderId).toBe('1047')
  })

  it('caps free text instead of rejecting it', () => {
    const parsed = parseOrder({
      ...VALID,
      items: [{ name: 'n'.repeat(250), quantity: 1, variant: 'v'.repeat(250) }],
      tracking: { carrier: 'c'.repeat(250), number: 'x'.repeat(250) },
      note: 'z'.repeat(600),
    })!
    expect(parsed.items[0]!.name).toHaveLength(200)
    expect(parsed.items[0]!.variant).toHaveLength(200)
    expect(parsed.tracking).toEqual({ carrier: 'c'.repeat(200), number: 'x'.repeat(200) })
    expect(parsed.note).toHaveLength(500)
  })

  it.each([
    ['not an object', 'order'],
    ['an array', [VALID]],
    ['null', null],
    ['a missing orderId', { ...VALID, orderId: undefined }],
    ['a blank orderId', { ...VALID, orderId: '   ' }],
    ['an orderId over 100 characters', { ...VALID, orderId: '1'.repeat(101) }],
    ['a fractional numeric orderId', { ...VALID, orderId: 10.5 }],
    ['a missing status', { ...VALID, status: undefined }],
    ['an unknown status', { ...VALID, status: 'lost' }],
    ['a status in the wrong case', { ...VALID, status: 'Shipped' }],
    ['a missing placedAt', { ...VALID, placedAt: undefined }],
    ['a non-ISO placedAt', { ...VALID, placedAt: 'yesterday' }],
    ['an impossible updatedAt', { ...VALID, updatedAt: '2026-13-45' }],
    ['a numeric updatedAt', { ...VALID, updatedAt: 1790000000 }],
    ['missing items', { ...VALID, items: undefined }],
    ['no items', { ...VALID, items: [] }],
    ['51 items', { ...VALID, items: Array.from({ length: 51 }, () => ({ name: 'x', quantity: 1 })) }],
    ['an item without a name', { ...VALID, items: [{ quantity: 1 }] }],
    ['a zero quantity', { ...VALID, items: [{ name: 'x', quantity: 0 }] }],
    ['a fractional quantity', { ...VALID, items: [{ name: 'x', quantity: 1.5 }] }],
    ['a string quantity', { ...VALID, items: [{ name: 'x', quantity: '2' }] }],
    ['a non-string variant', { ...VALID, items: [{ name: 'x', quantity: 1, variant: 7 }] }],
    ['an invalid eta', { ...VALID, eta: 'soon' }],
    ['tracking without a carrier', { ...VALID, tracking: { number: '1Z' } }],
    ['a javascript: tracking url', { ...VALID, tracking: { carrier: 'UPS', number: '1Z', url: 'javascript:alert(1)' } }],
    ['a tracking url over 500 characters', { ...VALID, tracking: { carrier: 'UPS', number: '1Z', url: `https://t.example/${'a'.repeat(500)}` } }],
    ['a non-string note', { ...VALID, note: { text: 'hi' } }],
  ])('rejects %s', (_label, value) => {
    expect(parseOrder(value)).toBeNull()
  })

  it('accepts exactly 50 items', () => {
    expect(parseOrder({ ...VALID, items: Array.from({ length: 50 }, () => ({ name: 'x', quantity: 1 })) })?.items).toHaveLength(50)
  })
})

describe('parseOrderList', () => {
  it('parses { orders } and keeps at most ORDER_LIST_MAX', () => {
    const orders = Array.from({ length: 8 }, (_, i) => ({ ...VALID, orderId: String(1001 + i) }))
    const parsed = parseOrderList({ orders, nextCursor: 'abc' })!
    expect(ORDER_LIST_MAX).toBe(5)
    expect(parsed.map((o) => o.orderId)).toEqual(['1001', '1002', '1003', '1004', '1005'])
  })

  it('returns an empty list as-is', () => {
    expect(parseOrderList({ orders: [] })).toEqual([])
  })

  it.each([
    ['a bare array', [VALID]],
    ['no orders key', { results: [VALID] }],
    ['orders that is not an array', { orders: VALID }],
    ['an invalid order', { orders: [VALID, { ...VALID, status: 'lost' }] }],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(parseOrderList(value)).toBeNull()
  })
})
