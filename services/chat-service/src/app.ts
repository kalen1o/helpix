import Fastify, { type FastifyInstance } from 'fastify'
import { HEADERS, registerErrorHandler, requireInternalToken } from '@helpix/shared'
import type { ChatDeps } from './deps'
import { adminRoutes } from './routes/admin'
import { messageRoutes } from './routes/messages'

export async function buildApp(deps: ChatDeps, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, requestIdHeader: HEADERS.requestId })
  registerErrorHandler(app)
  app.addHook('onRequest', requireInternalToken(deps.config.internalToken))

  app.get('/chat/health', async () => ({ ok: true }))
  await app.register(messageRoutes, deps)
  await app.register(adminRoutes, deps)
  return app
}
