import type { FastifyPluginAsync } from 'fastify'
import { AppError, CHAT_MESSAGE_MAX, readContext } from '@helpix/shared'
import type { ChatDeps } from '../deps'
import { openConversation, type Requester } from '../ownership'
import { openEventStream } from '../sse'
import { runTurn } from '../turn'

export const messageField = { type: 'string', minLength: 1, maxLength: CHAT_MESSAGE_MAX, pattern: '\\S' } as const
export const conversationIdField = { type: 'string', format: 'uuid' } as const

// No customerId here: on this route it comes only from the gateway (a verified shop JWT, spec §2.3). Fastify drops
// unknown body fields, so one sent in the body is ignored.
const messageBody = {
  type: 'object',
  required: ['message'],
  additionalProperties: false,
  properties: {
    message: messageField,
    conversationId: conversationIdField,
    sessionToken: { type: 'string', minLength: 1, maxLength: 100 },
  },
} as const

interface MessageBody {
  message: string
  conversationId?: string
  sessionToken?: string
}

export const messageRoutes: FastifyPluginAsync<ChatDeps> = async (app, deps) => {
  app.post<{ Body: MessageBody }>('/chat/messages', { schema: { body: messageBody } }, async (req, reply) => {
    const ctx = readContext(req)
    if (ctx.role) throw new AppError(403, 'forbidden', 'Admins test the agent in the playground')
    if (!ctx.tenantId) throw new AppError(403, 'forbidden', 'Missing tenant context')
    const tenantId = ctx.tenantId
    const requester: Requester = ctx.customerId
      ? { kind: 'customer', customerId: ctx.customerId }
      : { kind: 'anonymous', sessionToken: req.body.sessionToken ?? null }

    // Everything that can fail as a normal HTTP error happens before the stream opens.
    const { tenantName, config, orderLookup } = await deps.agentConfigs.getPublished(tenantId, req.id)
    const { conversation, sessionToken } = await openConversation(deps.db, {
      tenantId,
      conversationId: req.body.conversationId ?? null,
      requester,
    })
    await runTurn(
      deps,
      {
        tenantId,
        requestId: req.id,
        conversation,
        sessionToken,
        shopName: tenantName,
        config,
        userMessage: req.body.message.trim(),
        // Only the gateway-verified customer (spec 4b §2); a body customerId is dropped by the schema.
        customerId: ctx.customerId ?? null,
        orderLookup,
      },
      openEventStream(req, reply),
      req.log,
    )
  })
}
