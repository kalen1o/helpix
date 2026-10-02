import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify'
import { AppError, HEADERS, INTERNAL_CALLER_CHAT } from '@helpix/shared'
import { ORDER_ID_MAX, type OrderLookupResult } from '@helpix/shared/orders'
import type { RouteDeps } from '../deps'
import { CUSTOMER_ID_MAX } from '../lib/customerToken'
import { decryptSecret } from '../lib/secrets'
import type { ShopConn } from '../lib/shopClient'
import { getIntegrations } from '../repos/integrations'
import { getTenant } from '../repos/tenants'

const listParams = {
  type: 'object',
  required: ['tenantId'],
  properties: { tenantId: { type: 'string', format: 'uuid' } },
} as const

const orderParams = {
  type: 'object',
  required: ['tenantId', 'orderId'],
  properties: {
    tenantId: { type: 'string', format: 'uuid' },
    orderId: { type: 'string', minLength: 1, maxLength: ORDER_ID_MAX },
  },
} as const

const customerQuery = {
  type: 'object',
  required: ['customerId'],
  properties: { customerId: { type: 'string', minLength: 1, maxLength: CUSTOMER_ID_MAX } },
} as const

type Query = { customerId: string }

/**
 * Order lookups for chat-service (4b spec §3.4). The customer is exactly the `customerId` chat-service sends
 * (from the gateway-verified token or the playground); the tenant's own order API and key are used.
 * Shop failures are statuses in a 200 body, never HTTP errors, so a turn can always finish.
 */
export const internalOrdersRoutes: FastifyPluginAsync<RouteDeps> = async (app, { db, config, shop }) => {
  app.addHook('onRequest', async (req) => {
    if (req.headers[HEADERS.internalCaller] !== INTERNAL_CALLER_CHAT) throw new AppError(403, 'forbidden', 'Internal route')
  })

  async function connectionFor(tenantId: string, log: FastifyBaseLogger): Promise<ShopConn | OrderLookupResult> {
    const tenant = await getTenant(db, tenantId)
    if (!tenant) throw new AppError(404, 'tenant_not_found', 'Tenant not found')
    if (tenant.status !== 'active') throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
    const row = await getIntegrations(db, tenantId)
    if (!row?.order_api_base_url || !row.order_api_key_enc) return { status: 'not_configured' }
    try {
      return { baseUrl: row.order_api_base_url, apiKey: decryptSecret(row.order_api_key_enc, config.secretsMasterKey) }
    } catch {
      log.warn({ tenantId }, 'stored order API key could not be decrypted (was SECRETS_MASTER_KEY changed?)')
      return { status: 'misconfigured' }
    }
  }

  app.get<{ Params: { tenantId: string }; Querystring: Query }>(
    '/internal/orders/:tenantId',
    { schema: { params: listParams, querystring: customerQuery } },
    async (req): Promise<OrderLookupResult> => {
      const conn = await connectionFor(req.params.tenantId, req.log)
      if ('status' in conn) return conn
      const { status, orders } = await shop.listOrders(conn, req.query.customerId)
      return status === 'ok' ? { status, orders } : { status }
    },
  )

  app.get<{ Params: { tenantId: string; orderId: string }; Querystring: Query }>(
    '/internal/orders/:tenantId/:orderId',
    { schema: { params: orderParams, querystring: customerQuery } },
    async (req): Promise<OrderLookupResult> => {
      const conn = await connectionFor(req.params.tenantId, req.log)
      if ('status' in conn) return conn
      return shop.getOrder(conn, req.query.customerId, req.params.orderId)
    },
  )
}
