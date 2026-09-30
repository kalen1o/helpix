import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { HEADERS, registerErrorHandler } from '@helpix/shared'
import type { GatewayConfig } from './config'
import { enforceBodyLimit, forward } from './forward'

export interface GatewayDeps {
  config: GatewayConfig
  logger?: boolean
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export async function buildGateway(deps: GatewayDeps): Promise<FastifyInstance> {
  const { config } = deps
  const app = Fastify({ logger: deps.logger ?? false, genReqId: () => randomUUID() })

  // Bodies are streamed through untouched; size is enforced from Content-Length.
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload))

  registerErrorHandler(app)
  app.addHook('onRequest', enforceBodyLimit(config.bodyLimitBytes))
  app.addHook('onSend', async (req, reply) => {
    reply.header(HEADERS.requestId, req.id)
  })

  app.get('/health', async () => ({ ok: true }))

  app.route({
    method: [...METHODS],
    url: '/auth/*',
    handler: (req, reply) => forward(req, reply, { target: config.tenantAuthUrl, internalToken: config.internalToken }),
  })

  return app
}
