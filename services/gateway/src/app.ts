import { randomUUID } from 'node:crypto'
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { AppError, HEADERS, registerErrorHandler, TtlCache } from '@helpix/shared'
import type { ResolvedAdmin } from '@helpix/shared/api-types'
import type { GatewayConfig } from './config'
import { enforceBodyLimit, forward } from './forward'
import { canonicalPath } from './path'
import { createTenantAuthClient, type TenantAuthClient } from './tenantAuthClient'
import { createWidgetIdentity, enforceCredentialRules, isWidgetRoute, serveWidgetBundle } from './widget'

export interface GatewayDeps {
  config: GatewayConfig
  logger?: boolean
  tenantAuth?: TenantAuthClient
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/** KB uploads (a file up to 10 MB, or pasted text) are the only requests allowed past the default body limit. */
function isKbUpload(req: FastifyRequest): boolean {
  if (req.method !== 'POST') return false
  const q = req.url.indexOf('?')
  const pathname = q === -1 ? req.url : req.url.slice(0, q)
  return pathname === '/kb/documents' || pathname === '/kb/documents/text'
}

export async function buildGateway(deps: GatewayDeps): Promise<FastifyInstance> {
  const { config } = deps
  const tenantAuth = deps.tenantAuth ?? createTenantAuthClient(config.tenantAuthUrl, config.internalToken)
  const adminCache = new TtlCache<ResolvedAdmin>(config.resolveCacheTtlMs)
  const widgetIdentity = createWidgetIdentity(tenantAuth, config.resolveCacheTtlMs)

  const app = Fastify({ logger: deps.logger ?? false, genReqId: () => randomUUID() })

  // Bodies are streamed through untouched; size is enforced from Content-Length.
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload))

  registerErrorHandler(app)
  app.addHook('onRequest', enforceBodyLimit((req) => (isKbUpload(req) ? config.kbUploadLimitBytes : config.bodyLimitBytes)))
  app.addHook('onSend', async (req, reply) => {
    reply.header(HEADERS.requestId, req.id)
  })

  // Widget routes are called from shop pages on any origin; the tenant's allowed origins are enforced by the
  // widget-key resolver, not here. Admin routes keep the dashboard allowlist.
  await app.register(cors, {
    delegator: (req, cb) => {
      const widget = isWidgetRoute(req)
      cb(null, {
        origin: widget ? true : config.corsOrigins,
        methods: [...METHODS],
        allowedHeaders: widget ? ['content-type', HEADERS.widgetKey] : ['content-type', 'authorization'],
        exposedHeaders: [HEADERS.requestId],
      })
    },
  })
  app.addHook('onRequest', enforceCredentialRules)

  async function adminIdentity(req: FastifyRequest): Promise<Record<string, string>> {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
    if (!match) throw new AppError(401, 'unauthorized', 'Missing bearer token')
    const token = match[1]!
    let identity = adminCache.get(token)
    if (!identity) {
      identity = await tenantAuth.resolveAdmin(token, req.id)
      adminCache.set(token, identity)
    }
    return {
      [HEADERS.adminId]: identity.adminId,
      [HEADERS.role]: identity.role,
      ...(identity.tenantId ? { [HEADERS.tenantId]: identity.tenantId } : {}),
    }
  }

  app.get('/health', async () => ({ ok: true }))

  app.route({
    method: [...METHODS],
    url: '/auth/*',
    handler: (req, reply) =>
      forward(req, reply, {
        target: config.tenantAuthUrl,
        internalToken: config.internalToken,
        routePrefix: '/auth',
        path: canonicalPath(req.url, '/auth'),
      }),
  })

  app.post('/chat/messages', async (req, reply) => {
    const path = canonicalPath(req.url, '/chat')
    return forward(req, reply, {
      target: config.chatServiceUrl,
      internalToken: config.internalToken,
      routePrefix: '/chat',
      path,
      identity: await widgetIdentity(req),
    })
  })

  app.get('/widget/config', async (req, reply) => {
    const path = canonicalPath(req.url, '/widget')
    return forward(req, reply, {
      target: config.tenantAuthUrl,
      internalToken: config.internalToken,
      routePrefix: '/widget',
      path,
      identity: await widgetIdentity(req),
    })
  })

  app.get('/widget/helpix-widget.js', serveWidgetBundle(config.widgetBundlePath))

  for (const [url, routePrefix, target] of [
    ['/me', '/me', config.tenantAuthUrl],
    ['/admin/*', '/admin', config.tenantAuthUrl],
    ['/agent/*', '/agent', config.tenantAuthUrl],
    ['/kb/*', '/kb', config.kbServiceUrl],
    ['/chat/*', '/chat', config.chatServiceUrl],
  ] as const) {
    app.route({
      method: [...METHODS],
      url,
      handler: async (req, reply) => {
        // Validate the path before resolving the bearer token so a traversal attempt never reaches a backend.
        const path = canonicalPath(req.url, routePrefix)
        return forward(req, reply, {
          target,
          internalToken: config.internalToken,
          routePrefix,
          path,
          identity: await adminIdentity(req),
        })
      },
    })
  }

  return app
}
