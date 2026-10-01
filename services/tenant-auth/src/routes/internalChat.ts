import type { FastifyPluginAsync } from 'fastify'
import { AppError, HEADERS, INTERNAL_CALLER_CHAT } from '@helpix/shared'
import type { PublishedAgentConfig } from '@helpix/shared/api-types'
import type { RouteDeps } from '../deps'
import { getPublishedConfig } from '../repos/agentConfigs'

const tenantParams = {
  type: 'object',
  required: ['tenantId'],
  properties: { tenantId: { type: 'string', format: 'uuid' } },
} as const

/** Read-only routes for chat-service. Like the resolver routes, they need their own caller header on top of the token. */
export const internalChatRoutes: FastifyPluginAsync<RouteDeps> = async (app, { db }) => {
  app.addHook('onRequest', async (req) => {
    if (req.headers[HEADERS.internalCaller] !== INTERNAL_CALLER_CHAT) throw new AppError(403, 'forbidden', 'Internal route')
  })

  app.get<{ Params: { tenantId: string } }>(
    '/internal/agent-config/:tenantId',
    { schema: { params: tenantParams } },
    async (req): Promise<PublishedAgentConfig> => {
      const found = await getPublishedConfig(db, req.params.tenantId)
      if (!found) throw new AppError(404, 'tenant_not_found', 'Tenant not found')
      if (found.status !== 'active') throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
      return { tenantName: found.tenantName, config: found.config }
    },
  )
}
