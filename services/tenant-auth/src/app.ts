import Fastify, { type FastifyInstance } from 'fastify'
import { HEADERS, registerErrorHandler, requireInternalToken, type Db } from '@helpix/shared'
import type { Config } from './config'
import type { RouteDeps } from './deps'
import { createTokenService } from './lib/tokens'
import { authRoutes } from './routes/auth'

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
  return app
}
