// @vitest-environment node
import { parseOrder } from '@helpix/shared/orders'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loginAs, orderApi, startShop, type TestShop } from './helpers'

let shop: TestShop
beforeEach(async () => {
  shop = await startShop()
})
afterEach(async () => {
  await shop.close()
})

const LINE = { productId: 'orchard-one-pro', color: 'Glacier', gb: 256, quantity: 1 }
const checkout = (payload: unknown, cookie?: string) =>
  shop.app.inject({ method: 'POST', url: '/api/checkout', payload: payload as object, headers: cookie ? { cookie } : {} })
const getOrder = (orderId: string, headers: Record<string, string>) => shop.app.inject({ method: 'GET', url: `/orders/${encodeURIComponent(orderId)}`, headers })
const listOrders = (query: string, headers: Record<string, string>) => shop.app.inject({ method: 'GET', url: `/orders${query}`, headers })

describe('checkout', () => {
  it('requires a session', async () => {
    const res = await checkout({ items: [LINE] })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('not_signed_in')
  })

  it.each([
    ['no items', { items: [] }],
    ['no body', null],
    ['21 lines', { items: Array.from({ length: 21 }, () => LINE) }],
    ['an unknown product', { items: [{ ...LINE, productId: 'orchard-fold' }] }],
    ['a finish the product lacks', { items: [{ ...LINE, color: 'Coral' }] }],
    ['a capacity the product lacks', { items: [{ ...LINE, gb: 128 }] }],
    ['quantity 0', { items: [{ ...LINE, quantity: 0 }] }],
    ['quantity 11', { items: [{ ...LINE, quantity: 11 }] }],
    ['a fractional quantity', { items: [{ ...LINE, quantity: 1.5 }] }],
  ])('rejects %s', async (_label, payload) => {
    const cookie = await loginAs(shop.app, 'maya@orchard.demo')
    const res = await checkout(payload, cookie)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('invalid_items')
  })

  it('creates sequential processing orders owned by the customer', async () => {
    const cookie = await loginAs(shop.app, 'maya@orchard.demo')
    const first = await checkout({ items: [LINE, { productId: 'orchard-buds', color: 'Snow', gb: 0, quantity: 2 }] }, cookie)
    expect(first.statusCode).toBe(201)
    expect(first.json()).toEqual({ orderId: '1009' })
    expect((await checkout({ items: [LINE] }, cookie)).json()).toEqual({ orderId: '1010' })

    const mine = await getOrder('1009', orderApi('cust_maya'))
    expect(mine.statusCode).toBe(200)
    const order = mine.json()
    expect(parseOrder(order)).not.toBeNull()
    expect(order).toMatchObject({
      orderId: '1009',
      status: 'processing',
      items: [
        { name: 'Orchard One Pro', quantity: 1, variant: 'Glacier · 256 GB' },
        { name: 'Orchard Buds', quantity: 2, variant: 'Snow' },
      ],
    })
    expect(order).not.toHaveProperty('customerId')
    expect((await getOrder('1009', orderApi('cust_leo'))).statusCode).toBe(404)
  })
})

describe('order API', () => {
  it('rejects a missing, wrong or non-Bearer key with 401', async () => {
    expect((await getOrder('1001', { 'x-customer-id': 'cust_maya' })).statusCode).toBe(401)
    expect((await getOrder('1001', orderApi('cust_maya', 'wrong-key-0000'))).statusCode).toBe(401)
    expect((await getOrder('1001', { authorization: 'Basic dGVzdA==', 'x-customer-id': 'cust_maya' })).statusCode).toBe(401)
    const res = await listOrders('', orderApi('cust_maya', 'test-order-api-key-012345678'))
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthorized')
  })

  it('requires X-Customer-Id', async () => {
    const res = await getOrder('1001', { authorization: 'Bearer test-order-api-key-0123456789' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('missing_customer')
  })

  it('returns the owner’s order in the contract shape', async () => {
    const res = await getOrder('1006', orderApi('cust_maya'))
    expect(res.statusCode).toBe(200)
    expect(parseOrder(res.json())).not.toBeNull()
    expect(res.json()).toMatchObject({ orderId: '1006', status: 'shipped', tracking: { carrier: 'Swift Parcel' } })
  })

  // Review Focus #1: another customer's order is indistinguishable from an unknown one.
  it('gives 404 for another customer’s order, exactly like an unknown order', async () => {
    const foreign = await getOrder('1001', orderApi('cust_leo'))
    const unknown = await getOrder('9999', orderApi('cust_leo'))
    expect(foreign.statusCode).toBe(404)
    expect(foreign.json()).toEqual(unknown.json())
    expect(foreign.body).not.toContain('Orchard One Pro')
  })

  it('lists only the customer’s orders, newest first, default 5 and capped at 20', async () => {
    const maya = await listOrders('?limit=5', orderApi('cust_maya'))
    expect(maya.json().orders.map((o: { orderId: string }) => o.orderId)).toEqual(['1008', '1006', '1001'])
    expect((await listOrders('?limit=1', orderApi('cust_maya'))).json().orders).toHaveLength(1)
    expect((await listOrders('', orderApi('cust_nobody'))).json()).toEqual({ orders: [] })

    const cookie = await loginAs(shop.app, 'leo@orchard.demo')
    for (let i = 0; i < 21; i++) await checkout({ items: [LINE] }, cookie)
    const capped = (await listOrders('?limit=100', orderApi('cust_leo'))).json().orders
    expect(capped).toHaveLength(20)
    expect(capped[0].orderId).toBe('1029')
    expect((await listOrders('', orderApi('cust_leo'))).json().orders).toHaveLength(5)
    expect((await listOrders('?limit=abc', orderApi('cust_leo'))).json().orders).toHaveLength(5)
  })

  it('answers 503 until the shop is seeded', async () => {
    const bare = await startShop({ seeded: false })
    try {
      const res = await bare.app.inject({ method: 'GET', url: '/orders', headers: orderApi('cust_maya') })
      expect(res.statusCode).toBe(503)
      expect(res.json().error.message).toBe('Run make seed-demos first')
    } finally {
      await bare.close()
    }
  })
})
