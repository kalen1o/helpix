// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { chatEvents, chipsFor, customerLabel } from '../src/lib/chat'

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
