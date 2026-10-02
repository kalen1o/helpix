import type { ToolDefinition } from '@helpix/llm'
import type { ToolActivity } from '@helpix/shared/api-types'
import { orderToolStatus } from '@helpix/shared/chat'
import { ORDER_ID_MAX, type Order, type OrderLookupResult } from '@helpix/shared/orders'
import type { OrdersClient } from '../clients/orders'
import { parseArguments, type AgentTool, type ToolOutcome } from './searchKb'

export const LOOKUP_ORDER_TOOL: ToolDefinition = {
  name: 'lookup_order',
  description:
    "Look up the signed-in customer's orders in the shop's order system. With orderId, returns that order; without it, returns their most recent orders (up to 5). The customer is already signed in and verified.",
  parameters: {
    type: 'object',
    properties: {
      orderId: {
        type: 'string',
        maxLength: 100,
        description: 'The order number the customer gave, e.g. "1047". Leave it out to list their recent orders.',
      },
    },
    additionalProperties: false,
  },
}

export const ORDER_NOT_FOUND = "No order with that number on this customer's account."
export const ORDERS_UNAVAILABLE =
  "The shop's order system can't be reached right now. Say you can't check orders at the moment and never guess."
const NO_ORDERS = 'This customer has no orders on their account.'
const INVALID_ARGUMENTS = 'Invalid arguments: "orderId" must be an order number of at most 100 characters, or left out.'
const INVALID = Symbol('invalid')
const NOT_FOUND = Symbol('not_found')

/**
 * The order id the model asked for: null to list recent orders, INVALID when it cannot be an order number, NOT_FOUND
 * for "." or "..", which would change the order API path and can never be a real order.
 */
function orderIdFrom(args: Record<string, unknown>): string | null | typeof INVALID | typeof NOT_FOUND {
  const raw = args.orderId
  if (raw === undefined || raw === null) return null
  let text: string
  if (typeof raw === 'string') text = raw
  else if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) text = String(raw)
  else return INVALID
  const id = text.trim().replace(/^#\s*/, '')
  if (id === '') return null
  if (id === '.' || id === '..') return NOT_FOUND
  return id.length > ORDER_ID_MAX ? INVALID : id
}

/**
 * lookup_order for one turn (spec 4b §4). The tenant and the customer are fixed here from the verified request, or
 * the playground's test customer; the model only chooses which order. Anything it passes beyond `orderId` is ignored.
 */
export function createLookupOrderTool(orders: OrdersClient, tenantId: string, customerId: string, requestId: string): AgentTool {
  return {
    definition: LOOKUP_ORDER_TOOL,
    async run(raw): Promise<ToolOutcome> {
      // Some models send empty arguments for a call with no required parameters.
      const args: Record<string, unknown> | null = raw.trim() === '' ? {} : parseArguments(raw)
      const activity = (over: Partial<ToolActivity>): ToolActivity => ({
        name: LOOKUP_ORDER_TOOL.name,
        arguments: args,
        status: 'ok',
        results: [],
        error: null,
        ...over,
      })
      const orderId = args === null ? INVALID : orderIdFrom(args)
      if (orderId === INVALID) {
        return { content: JSON.stringify({ error: INVALID_ARGUMENTS }), activity: activity({ status: 'error', error: 'invalid_arguments' }) }
      }
      if (orderId === NOT_FOUND) return { content: ORDER_NOT_FOUND, activity: activity({ status: orderToolStatus('not_found') }) }

      let result: OrderLookupResult
      try {
        result =
          orderId === null
            ? await orders.list(tenantId, customerId, requestId)
            : await orders.get(tenantId, customerId, orderId, requestId)
      } catch {
        result = { status: 'unavailable' }
      }

      if (result.status === 'ok') {
        const found: Order[] = result.order ? [result.order] : (result.orders ?? [])
        const content = result.order
          ? JSON.stringify({ order: result.order })
          : found.length > 0
            ? JSON.stringify({ orders: found })
            : JSON.stringify({ orders: [], note: NO_ORDERS })
        return { content, activity: activity({ orders: found }) }
      }
      if (result.status === 'not_found') {
        return { content: ORDER_NOT_FOUND, activity: activity({ status: orderToolStatus(result.status) }) }
      }
      return { content: ORDERS_UNAVAILABLE, activity: activity({ status: orderToolStatus(result.status), error: result.status }) }
    },
  }
}
