import { describe, expect, it } from 'vitest'
import type { OrdersClient } from '../src/clients/orders'
import { createLookupOrderTool, LOOKUP_ORDER_TOOL, ORDER_NOT_FOUND, ORDERS_UNAVAILABLE } from '../src/agent/lookupOrder'
import { fakeOrders, ORDER, ORDER_2 } from './helpers'

const tool = (orders: OrdersClient) => createLookupOrderTool(orders, 'tenant-a', 'cust_maya', 'req-1')

describe('LOOKUP_ORDER_TOOL', () => {
  it('takes only an optional order id; the model cannot name a customer', () => {
    expect(LOOKUP_ORDER_TOOL.name).toBe('lookup_order')
    const params = LOOKUP_ORDER_TOOL.parameters as { properties: Record<string, unknown>; required?: string[]; additionalProperties: boolean }
    expect(Object.keys(params.properties)).toEqual(['orderId'])
    expect(params.required).toBeUndefined()
    expect(params.additionalProperties).toBe(false)
  })

  it('tells the model the customer is already signed in', () => {
    expect(LOOKUP_ORDER_TOOL.description).toContain('The customer is already signed in and verified.')
  })
})

describe('createLookupOrderTool', () => {
  it('looks up one order and gives the model the order as JSON', async () => {
    const orders = fakeOrders({ status: 'ok', order: ORDER })
    const out = await tool(orders).run('{"orderId":"1001"}')
    expect(orders.calls).toEqual([{ kind: 'get', tenantId: 'tenant-a', customerId: 'cust_maya', orderId: '1001' }])
    expect(JSON.parse(out.content)).toEqual({ order: ORDER })
    expect(out.activity).toEqual({
      name: 'lookup_order',
      arguments: { orderId: '1001' },
      status: 'ok',
      results: [],
      error: null,
      orders: [ORDER],
    })
  })

  it('lists recent orders without an order id (also for empty arguments)', async () => {
    for (const raw of ['{}', '', '{"orderId":"  "}']) {
      const orders = fakeOrders({ status: 'ok', orders: [ORDER, ORDER_2] })
      const out = await tool(orders).run(raw)
      expect(orders.calls, raw).toEqual([{ kind: 'list', tenantId: 'tenant-a', customerId: 'cust_maya', orderId: null }])
      expect(JSON.parse(out.content)).toEqual({ orders: [ORDER, ORDER_2] })
      expect(out.activity).toMatchObject({ status: 'ok', error: null, orders: [ORDER, ORDER_2] })
    }
  })

  it('tells the model when the customer has no orders', async () => {
    const out = await tool(fakeOrders({ status: 'ok', orders: [] })).run('{}')
    expect(JSON.parse(out.content)).toEqual({ orders: [], note: 'This customer has no orders on their account.' })
    expect(out.activity).toMatchObject({ status: 'ok', orders: [] })
  })

  it('uses the bound tenant and customer whatever the model passes', async () => {
    const orders = fakeOrders({ status: 'ok', order: ORDER })
    const out = await tool(orders).run(JSON.stringify({ orderId: '1001', customerId: 'cust_leo', tenantId: 'tenant-b' }))
    expect(orders.calls).toEqual([{ kind: 'get', tenantId: 'tenant-a', customerId: 'cust_maya', orderId: '1001' }])
    expect(out.activity.arguments).toEqual({ orderId: '1001', customerId: 'cust_leo', tenantId: 'tenant-b' })
  })

  it('accepts "#1001" and a numeric 1001 as order 1001', async () => {
    for (const raw of ['{"orderId":"#1001"}', '{"orderId":1001}']) {
      const orders = fakeOrders({ status: 'ok', order: ORDER })
      await tool(orders).run(raw)
      expect(orders.calls[0]!.orderId, raw).toBe('1001')
    }
  })

  it('maps not_found to the not-found message and an empty activity', async () => {
    const out = await tool(fakeOrders({ status: 'not_found' })).run('{"orderId":"9999"}')
    expect(out.content).toBe(ORDER_NOT_FOUND)
    expect(ORDER_NOT_FOUND).toBe("No order with that number on this customer's account.")
    expect(out.activity).toEqual({ name: 'lookup_order', arguments: { orderId: '9999' }, status: 'empty', results: [], error: null })
  })

  it.each(['.', '..', '#..'])('treats the order id %s as not found without calling the order system', async (orderId) => {
    const orders = fakeOrders({ status: 'ok', order: ORDER })
    const out = await tool(orders).run(JSON.stringify({ orderId }))
    expect(orders.calls).toEqual([])
    expect(out.content).toBe(ORDER_NOT_FOUND)
    expect(out.activity).toEqual({ name: 'lookup_order', arguments: { orderId }, status: 'empty', results: [], error: null })
  })

  it.each(['unavailable', 'misconfigured', 'not_configured'] as const)('maps %s to the never-guess message', async (status) => {
    const out = await tool(fakeOrders({ status })).run('{"orderId":"1001"}')
    expect(out.content).toBe(ORDERS_UNAVAILABLE)
    expect(ORDERS_UNAVAILABLE).toBe("The shop's order system can't be reached right now. Say you can't check orders at the moment and never guess.")
    expect(out.activity).toEqual({ name: 'lookup_order', arguments: { orderId: '1001' }, status: 'error', results: [], error: status })
  })

  it('treats a client that throws as unavailable', async () => {
    const orders: OrdersClient = {
      get: async () => { throw new Error('boom') },
      list: async () => { throw new Error('boom') },
    }
    const out = await tool(orders).run('{}')
    expect(out.content).toBe(ORDERS_UNAVAILABLE)
    expect(out.activity).toMatchObject({ status: 'error', error: 'unavailable' })
  })

  it.each([
    ['arguments that are not JSON', 'not json'],
    ['an order id over 100 characters', JSON.stringify({ orderId: 'x'.repeat(101) })],
    ['an order id that is an object', '{"orderId":{"id":1}}'],
    ['a negative number', '{"orderId":-1}'],
  ])('rejects %s without calling the order system', async (_label, raw) => {
    const orders = fakeOrders({ status: 'ok', order: ORDER })
    const out = await tool(orders).run(raw)
    expect(orders.calls).toEqual([])
    expect(JSON.parse(out.content).error).toContain('orderId')
    expect(out.activity).toMatchObject({ name: 'lookup_order', status: 'error', error: 'invalid_arguments', results: [] })
  })
})
