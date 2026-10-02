import type { FastifyPluginAsync } from 'fastify'
import { AppError, HEADERS, INTERNAL_CALLER_RESOLVER } from '@helpix/shared'
import type { ResolvedAdmin, ResolvedWidget } from '@helpix/shared/api-types'
import { assertAdminActive } from '../auth/service'
import type { RouteDeps } from '../deps'
import { CUSTOMER_TOKEN_MAX, invalidCustomerToken, verifyCustomerToken } from '../lib/customerToken'
import { tryNormalizeOrigin } from '../lib/origins'
import { findAdminById } from '../repos/admins'
import { getIntegrations } from '../repos/integrations'
import { findTenantByWidgetKey } from '../repos/tenants'

const resolveAdminBody = {
  type: 'object',
  required: ['accessToken'],
  properties: { accessToken: { type: 'string', minLength: 1, maxLength: 4000 } },
} as const

const resolveWidgetBody = {
  type: 'object',
  required: ['widgetKey', 'origin'],
  properties: {
    widgetKey: { type: 'string', minLength: 1, maxLength: 200 },
    origin: { type: ['string', 'null'], maxLength: 300 },
    customerToken: { type: 'string', minLength: 1, maxLength: CUSTOMER_TOKEN_MAX },
  },
} as const

export const internalRoutes: FastifyPluginAsync<RouteDeps> = async (app, { db, tokens }) => {
  // Defence in depth: the internal token alone is not enough, because the gateway attaches it to every
  // forwarded client request. Only the gateway's resolver client sends this header (the gateway strips it
  // from client requests).
  app.addHook('onRequest', async (req) => {
    if (req.headers[HEADERS.internalCaller] !== INTERNAL_CALLER_RESOLVER) {
      throw new AppError(403, 'forbidden', 'Internal route')
    }
  })

  app.post<{ Body: { accessToken: string } }>(
    '/internal/resolve-admin',
    { schema: { body: resolveAdminBody } },
    async (req): Promise<ResolvedAdmin> => {
      const claims = await tokens.verifyAccess(req.body.accessToken)
      const admin = claims ? await findAdminById(db, claims.adminId) : null
      if (!admin) throw new AppError(401, 'invalid_token', 'Invalid or expired access token')
      await assertAdminActive(db, admin)
      return { adminId: admin.id, role: admin.role, tenantId: admin.tenant_id }
    },
  )

  app.post<{ Body: { widgetKey: string; origin: string | null; customerToken?: string } }>(
    '/internal/resolve-widget',
    { schema: { body: resolveWidgetBody } },
    async (req): Promise<ResolvedWidget> => {
      const tenant = await findTenantByWidgetKey(db, req.body.widgetKey)
      if (!tenant) throw new AppError(401, 'invalid_widget_key', 'Unknown widget key')
      if (tenant.status !== 'active') throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
      const origin = tryNormalizeOrigin(req.body.origin)
      if (!origin || !tenant.allowedOrigins.includes(origin)) {
        throw new AppError(403, 'origin_not_allowed', 'This site is not allowed to use this widget key')
      }
      if (req.body.customerToken === undefined) return { tenantId: tenant.id }
      // The shopper's identity: verified against this tenant's own shop key, with aud = this tenant's widget key.
      const integrations = await getIntegrations(db, tenant.id)
      if (!integrations?.shop_key_pem) throw invalidCustomerToken()
      const { customerId } = await verifyCustomerToken(req.body.customerToken, {
        pem: integrations.shop_key_pem,
        audience: tenant.widgetKey,
      })
      return { tenantId: tenant.id, customerId }
    },
  )
}
