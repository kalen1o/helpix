import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { AGENT_CONFIG_SCHEMA, readContext, requireRole } from '@helpix/shared'
import type { AgentConfig, AgentConfigState } from '@helpix/shared/api-types'
import type { RouteDeps } from '../deps'
import { getAgentConfigState, publishDraft, saveDraft } from '../repos/agentConfigs'

/** The tenant of the tenant admin; the onRequest hook has already checked the role. */
const tenantOf = (req: FastifyRequest): string => readContext(req).tenantId!

export const agentConfigRoutes: FastifyPluginAsync<RouteDeps> = async (app, { db }) => {
  // onRequest runs before body validation, so a non-admin gets 403 rather than a validation error.
  app.addHook('onRequest', async (req) => requireRole(readContext(req), 'tenant_admin'))

  app.get('/agent/config', async (req): Promise<AgentConfigState> => getAgentConfigState(db, tenantOf(req)))

  app.put<{ Body: AgentConfig }>(
    '/agent/config/draft',
    { schema: { body: AGENT_CONFIG_SCHEMA } },
    async (req): Promise<AgentConfigState> =>
      saveDraft(db, tenantOf(req), { ...req.body, greeting: req.body.greeting.trim(), toneNotes: req.body.toneNotes.trim() }),
  )

  app.post('/agent/config/publish', async (req): Promise<AgentConfigState> => publishDraft(db, tenantOf(req)))
}
