import type { FastifyPluginAsync } from 'fastify'
import { AppError, readContext } from '@helpix/shared'
import type { WidgetConfig } from '@helpix/shared/api-types'
import type { RouteDeps } from '../deps'
import { getPublishedConfig } from '../repos/agentConfigs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Called by the gateway for the chat widget: the tenant comes from a resolved widget key, never from an admin. */
export const widgetRoutes: FastifyPluginAsync<RouteDeps> = async (app, { db }) => {
  app.get('/widget/config', async (req): Promise<WidgetConfig> => {
    const ctx = readContext(req)
    if (ctx.role || ctx.adminId) throw new AppError(403, 'forbidden', 'This route is for the chat widget')
    if (!ctx.tenantId || !UUID.test(ctx.tenantId)) throw new AppError(403, 'forbidden', 'Missing tenant context')
    const found = await getPublishedConfig(db, ctx.tenantId)
    if (!found) throw new AppError(404, 'tenant_not_found', 'Tenant not found')
    if (found.status !== 'active') throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
    return {
      shopName: found.tenantName,
      greeting: found.config.greeting,
      accentColor: found.config.accentColor,
      orderLookup: false,
    }
  })
}
