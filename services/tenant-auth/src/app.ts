import Fastify, { type FastifyInstance } from 'fastify'
import { HEADERS, registerErrorHandler, requireInternalToken, type Db } from '@helpix/shared'
import type { Config } from './config'
import type { RouteDeps } from './deps'
import { createTokenService } from './lib/tokens'
import { authRoutes } from './routes/auth'
import { agentConfigRoutes } from './routes/agentConfig'
import { internalRoutes } from './routes/internal'
import { internalChatRoutes } from './routes/internalChat'
import { meRoutes } from './routes/me'
import { tenantRoutes } from './routes/tenants'
import { widgetRoutes } from './routes/widget'

export interface AppOptions {
  db: Db
  config: Config
  logger?: boolean
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, requestIdHeader: HEADERS.requestId })
  registerErrorHandler(app)
  app.addHook('onRequest', requireInternalToken(opts.config.internalToken))

  const deps: RouteDeps = {
    db: opts.db,
    config: opts.config,
    tokens: createTokenService(opts.config.adminJwtSecret, opts.config.accessTtl),
  }
  await app.register(authRoutes, deps)
  await app.register(internalRoutes, deps)
  await app.register(meRoutes, deps)
  await app.register(tenantRoutes, deps)
  await app.register(agentConfigRoutes, deps)
  await app.register(internalChatRoutes, deps)
  await app.register(widgetRoutes, deps)
  return app
}
