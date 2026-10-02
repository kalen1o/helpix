import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { AppError, readContext, requireRole } from '@helpix/shared'
import type { IntegrationsView, OrderApiTestResult } from '@helpix/shared/api-types'
import type { OrderLookupResult } from '@helpix/shared/orders'
import type { RouteDeps } from '../deps'
import { assertPublicHost, BASE_URL_MAX, normalizeBaseUrl } from '../lib/baseUrl'
import { CUSTOMER_ID_MAX } from '../lib/customerToken'
import { decryptSecret, encryptSecret } from '../lib/secrets'
import { parseShopPublicKey, SHOP_KEY_PEM_MAX } from '../lib/shopKey'
import {
  clearOrderApi,
  clearShopKey,
  getIntegrations,
  setOrderApi,
  setShopKey,
  toIntegrationsView,
} from '../repos/integrations'

const API_KEY_MIN = 8
const API_KEY_MAX = 500

const orderApiBody = {
  type: 'object',
  required: ['baseUrl'],
  additionalProperties: false,
  properties: {
    baseUrl: { type: 'string', minLength: 1, maxLength: BASE_URL_MAX },
    apiKey: { type: 'string', minLength: API_KEY_MIN, maxLength: API_KEY_MAX },
  },
} as const

const testBody = {
  type: 'object',
  required: ['customerId'],
  additionalProperties: false,
  properties: { customerId: { type: 'string', minLength: 1, maxLength: CUSTOMER_ID_MAX } },
} as const

const shopKeyBody = {
  type: 'object',
  required: ['publicKeyPem'],
  additionalProperties: false,
  properties: { publicKeyPem: { type: 'string', minLength: 1, maxLength: SHOP_KEY_PEM_MAX } },
} as const

/** The tenant of the tenant admin; the onRequest hook has already checked the role. */
const tenantOf = (req: FastifyRequest): string => readContext(req).tenantId!

/** A test-connection result in words an admin can act on. */
function describeTest(r: OrderLookupResult & { httpStatus?: number }): OrderApiTestResult {
  const fail = (message: string): OrderApiTestResult => ({ ok: false, status: r.status, message })
  switch (r.status) {
    case 'ok':
      return {
        ok: true,
        status: 'ok',
        message: r.orders?.length ? 'Connected. The shop returned an order for this customer.' : 'Connected. This customer has no orders yet.',
      }
    case 'not_found':
      return fail("The shop's order API answered 404. Check the base URL.")
    case 'misconfigured':
      return fail(`The shop rejected the API key (${r.httpStatus ?? 401})`)
    case 'not_configured':
      return fail('Save the order API URL and key first.')
    case 'unavailable': {
      const s = r.httpStatus
      if (s === undefined) return fail("The shop's order API timed out or is unreachable")
      if (s === 200) return fail("The response didn't match the order format")
      if (s >= 300 && s < 400) return fail(`The shop's order API redirected (${s}). Use the final URL as the base URL.`)
      return fail(`The shop's order API returned an error (${s})`)
    }
  }
}

/** Integrations page (4b spec §3.2). The order API key is write-only: no response ever contains it. */
export const integrationRoutes: FastifyPluginAsync<RouteDeps> = async (app, { db, config, shop }) => {
  // onRequest runs before body validation, so a non-admin gets 403 rather than a validation error.
  app.addHook('onRequest', async (req) => requireRole(readContext(req), 'tenant_admin'))

  app.get('/integrations', async (req): Promise<IntegrationsView> => toIntegrationsView(await getIntegrations(db, tenantOf(req))))

  app.put<{ Body: { baseUrl: string; apiKey?: string } }>(
    '/integrations/order-api',
    { schema: { body: orderApiBody } },
    async (req): Promise<IntegrationsView> => {
      const baseUrl = normalizeBaseUrl(req.body.baseUrl)
      await assertPublicHost(baseUrl, config.orderApiAllowPrivateHosts)
      const apiKey = req.body.apiKey?.trim()
      if (apiKey !== undefined && apiKey.length < API_KEY_MIN) {
        throw new AppError(400, 'invalid_api_key', `The API key must be ${API_KEY_MIN}–${API_KEY_MAX} characters`)
      }
      if (apiKey === undefined) {
        // The stored key is only ever sent to the host it was entered for, so a new origin needs the key again.
        const stored = (await getIntegrations(db, tenantOf(req)))?.order_api_base_url
        if (stored && new URL(stored).origin !== new URL(baseUrl).origin) {
          throw new AppError(400, 'api_key_required', 'Enter the API key again when changing the order API host.')
        }
      }
      const keyEnc = apiKey === undefined ? null : encryptSecret(apiKey, config.secretsMasterKey)
      const row = await setOrderApi(db, tenantOf(req), baseUrl, keyEnc)
      if (!row) throw new AppError(400, 'api_key_required', 'Enter the order API key')
      return toIntegrationsView(row)
    },
  )

  app.delete('/integrations/order-api', async (req, reply) => {
    await clearOrderApi(db, tenantOf(req))
    return reply.code(204).send()
  })

  app.post<{ Body: { customerId: string } }>(
    '/integrations/order-api/test',
    { schema: { body: testBody } },
    async (req): Promise<OrderApiTestResult> => {
      const row = await getIntegrations(db, tenantOf(req))
      if (!row?.order_api_base_url || !row.order_api_key_enc) return describeTest({ status: 'not_configured' })
      let apiKey: string
      try {
        apiKey = decryptSecret(row.order_api_key_enc, config.secretsMasterKey)
      } catch {
        return { ok: false, status: 'misconfigured', message: 'The saved API key could not be read. Save it again.' }
      }
      return describeTest(await shop.listOrders({ baseUrl: row.order_api_base_url, apiKey }, req.body.customerId, 1))
    },
  )

  app.put<{ Body: { publicKeyPem: string } }>(
    '/integrations/shop-key',
    { schema: { body: shopKeyBody } },
    async (req): Promise<IntegrationsView> => {
      const { pem, fingerprint } = await parseShopPublicKey(req.body.publicKeyPem)
      return toIntegrationsView(await setShopKey(db, tenantOf(req), pem, fingerprint))
    },
  )

  app.delete('/integrations/shop-key', async (req, reply) => {
    await clearShopKey(db, tenantOf(req))
    return reply.code(204).send()
  })
}
