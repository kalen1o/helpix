import Fastify, { type FastifyInstance } from 'fastify'
import { HEADERS, registerErrorHandler, requireInternalToken } from '@helpix/shared'
import type { KbDeps } from './deps'
import { documentRoutes } from './routes/documents'
import { reindexRoutes } from './routes/reindex'
import { searchRoutes } from './routes/search'

export async function buildApp(deps: KbDeps, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, requestIdHeader: HEADERS.requestId })
  registerErrorHandler(app)
  app.addHook('onRequest', requireInternalToken(deps.config.internalToken))

  app.get('/kb/health', async () => ({ ok: true }))
  await app.register(documentRoutes, deps)
  await app.register(searchRoutes, deps)
  await app.register(reindexRoutes, deps)
  return app
}
