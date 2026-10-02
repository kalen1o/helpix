// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { chatEvents, chipsFor, customerLabel, orderSummary } from '../src/lib/chat'

describe('customerLabel', () => {
  it.each([
    [{ isPlayground: false, customerId: 'cust_1001' }, 'cust_1001'],
    [{ isPlayground: false, customerId: null }, 'Anonymous visitor'],
    [{ isPlayground: true, customerId: 'cust_1001' }, 'Test as cust_1001'],
    [{ isPlayground: true, customerId: null }, 'Admin test'],
  ])('%j → %s', (c, label) => {
    expect(customerLabel(c)).toBe(label)
  })
})

it('re-exports the shared chat helpers', () => {
  expect(typeof chatEvents).toBe('function')
  expect(typeof chipsFor).toBe('function')
})

describe('orderSummary', () => {
  it('lists the id, status and items', () => {
    expect(
      orderSummary({
        orderId: '1047',
        status: 'shipped',
        placedAt: '2026-09-28T10:00:00Z',
        updatedAt: '2026-09-30T10:00:00Z',
        items: [{ name: 'iPhone 15', quantity: 1, variant: 'Blue, 128 GB' }, { name: 'USB-C cable', quantity: 2 }],
      }),
    ).toBe('#1047 · shipped · 1 × iPhone 15 (Blue, 128 GB), 2 × USB-C cable')
  })

  it('leaves out an empty item list', () => {
    expect(orderSummary({ orderId: '1', status: 'cancelled', placedAt: 'x', updatedAt: 'x', items: [] })).toBe('#1 · cancelled')
  })
})
