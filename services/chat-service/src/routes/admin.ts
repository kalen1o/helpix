import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { AGENT_CONFIG_SCHEMA, AppError, readContext, requireRole } from '@helpix/shared'
import type { AgentConfig, ChatModelsResponse, ConversationDetail, ConversationListResponse } from '@helpix/shared/api-types'
import type { ChatDeps } from '../deps'
import { getConversationSummary, listConversations } from '../repos/conversations'
import { listMessages } from '../repos/messages'
import { openPlaygroundConversation } from '../ownership'
import { openEventStream } from '../sse'
import { runTurn } from '../turn'
import { conversationIdField, messageField } from './messages'

const playgroundBody = {
  type: 'object',
  required: ['message', 'config'],
  additionalProperties: false,
  properties: {
    message: messageField,
    conversationId: conversationIdField,
    config: AGENT_CONFIG_SCHEMA,
    customerId: { type: ['string', 'null'], maxLength: 200 },
  },
} as const

const listQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['real', 'playground'], default: 'real' },
    before: { type: 'string', format: 'date-time' },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  },
} as const

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const

interface PlaygroundBody {
  message: string
  conversationId?: string
  config: AgentConfig
  customerId?: string | null
}

/** The tenant of the tenant admin; the onRequest hook has already checked the role. */
const tenantOf = (req: FastifyRequest): string => readContext(req).tenantId!

export const adminRoutes: FastifyPluginAsync<ChatDeps> = async (app, deps) => {
  app.addHook('onRequest', async (req) => requireRole(readContext(req), 'tenant_admin'))

  // Spec §3.7: the real agent loop and KB, on the draft config from the body. This is the only route that takes a
  // customer id from a request body.
  app.post<{ Body: PlaygroundBody }>('/chat/playground', { schema: { body: playgroundBody } }, async (req, reply) => {
    const tenantId = tenantOf(req)
    // The draft config comes from the body; whether the shop has an order API is the live setting.
    const { tenantName, orderLookup } = await deps.agentConfigs.getPublished(tenantId, req.id)
    const customerId = req.body.customerId?.trim() || null
    const conversation = await openPlaygroundConversation(deps.db, {
      tenantId,
      conversationId: req.body.conversationId ?? null,
      customerId,
    })
    await runTurn(
      deps,
      {
        tenantId,
        requestId: req.id,
        conversation,
        sessionToken: null,
        shopName: tenantName,
        config: req.body.config,
        userMessage: req.body.message.trim(),
        customerId,
        orderLookup,
      },
      openEventStream(req, reply),
      req.log,
    )
  })

  app.get('/chat/models', async (): Promise<ChatModelsResponse> => ({
    defaultModel: deps.chat.defaultModel,
    overrides: deps.config.modelOverrides,
  }))

  app.get<{ Querystring: { kind: 'real' | 'playground'; before?: string; limit: number } }>(
    '/chat/conversations',
    { schema: { querystring: listQuery } },
    async (req): Promise<ConversationListResponse> =>
      listConversations(deps.db, tenantOf(req), {
        playground: req.query.kind === 'playground',
        before: req.query.before ?? null,
        limit: req.query.limit,
      }),
  )

  app.get<{ Params: { id: string } }>(
    '/chat/conversations/:id',
    { schema: { params: idParams } },
    async (req): Promise<ConversationDetail> => {
      const tenantId = tenantOf(req)
      const conversation = await getConversationSummary(deps.db, tenantId, req.params.id)
      if (!conversation) throw new AppError(404, 'conversation_not_found', 'Conversation not found')
      return { conversation, messages: await listMessages(deps.db, tenantId, req.params.id) }
    },
  )
}
