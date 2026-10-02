import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AppError, HEADERS, TtlCache } from '@helpix/shared'
import type { ResolvedWidget } from '@helpix/shared/api-types'
import type { TenantAuthClient } from './tenantAuthClient'

/** The only routes a widget key opens (spec 4a §2). Everything else is admin-only. */
const WIDGET_ROUTES = new Set(['/chat/messages', '/widget/config'])

const WIDGET_KEY_MAX = 200
const ORIGIN_MAX = 300
const CUSTOMER_TOKEN_MAX = 4096

/**
 * The token's `exp` in seconds, read WITHOUT verifying it. It is used only to bound how long the gateway caches
 * tenant-auth's answer; tenant-auth has already verified the signature and expiry. Null when it cannot be read.
 */
export function unverifiedExp(token: string): number | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const exp: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))?.exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null
  } catch {
    return null
  }
}

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex')

export function pathnameOf(url: string): string {
  const q = url.indexOf('?')
  return q === -1 ? url : url.slice(0, q)
}

export function isWidgetRoute(req: FastifyRequest): boolean {
  return WIDGET_ROUTES.has(pathnameOf(req.url))
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * onRequest: a widget key never mixes with a bearer token, and never opens a non-widget route. Runs before routing,
 * so `/auth/*` (which does not resolve a bearer) is covered too. Preflights carry no credentials and pass.
 */
export async function enforceCredentialRules(req: FastifyRequest): Promise<void> {
  if (header(req, HEADERS.widgetKey) === undefined) return
  if (req.headers.authorization !== undefined) {
    throw new AppError(400, 'ambiguous_credentials', 'Send either a widget key or a bearer token, not both')
  }
  if (!isWidgetRoute(req)) throw new AppError(403, 'forbidden', 'A widget key only works on the chat widget routes')
}

/**
 * Resolves the widget key + Origin (+ shopper token) into identity headers. Successes are cached per (key, origin,
 * token hash); a token's entry lives no longer than its `exp`. Errors are never cached.
 */
export function createWidgetIdentity(tenantAuth: TenantAuthClient, ttlMs: number, now: () => number = Date.now) {
  const cache = new TtlCache<ResolvedWidget>(ttlMs, 10_000, now)
  return async (req: FastifyRequest): Promise<Record<string, string>> => {
    const key = header(req, HEADERS.widgetKey)
    if (!key) {
      if (req.headers.authorization !== undefined) throw new AppError(403, 'forbidden', 'This route is for the chat widget')
      throw new AppError(401, 'invalid_widget_key', 'Missing widget key')
    }
    // tenant-auth's schema caps these at 200/300/4096 and answers longer values with a 400 that would surface as a 502.
    if (key.length > WIDGET_KEY_MAX) throw new AppError(401, 'invalid_widget_key', 'Unknown widget key')
    const origin = header(req, 'origin')
    if (!origin) throw new AppError(403, 'origin_not_allowed', 'This site is not allowed to use this widget key')
    if (origin.length > ORIGIN_MAX) throw new AppError(403, 'origin_not_allowed', 'This site is not allowed to use this widget key')
    const token = header(req, HEADERS.customerToken)
    if (token !== undefined && token.length > CUSTOMER_TOKEN_MAX) {
      throw new AppError(401, 'invalid_customer_token', 'The customer token is invalid')
    }
    const cacheKey = token === undefined ? `${key}\n${origin}` : `${key}\n${origin}\n${sha256hex(token)}`
    let resolved = cache.get(cacheKey)
    if (!resolved) {
      resolved = await tenantAuth.resolveWidget(key, origin, req.id, token)
      if (token === undefined) {
        cache.set(cacheKey, resolved)
      } else {
        const exp = unverifiedExp(token)
        const ttl = exp === null ? 0 : Math.min(ttlMs, exp * 1000 - now())
        if (ttl > 0) cache.set(cacheKey, resolved, ttl)
      }
    }
    return {
      [HEADERS.tenantId]: resolved.tenantId,
      ...(resolved.customerId ? { [HEADERS.customerId]: resolved.customerId } : {}),
    }
  }
}

/** GET /widget/helpix-widget.js. Read per request so `vite build --watch` output is picked up in dev. */
export function serveWidgetBundle(path: string) {
  return async (_req: FastifyRequest, reply: FastifyReply) => {
    let file: Buffer
    try {
      file = await readFile(path)
    } catch {
      throw new AppError(404, 'not_found', 'The widget bundle has not been built')
    }
    return reply
      .type('application/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .header('cross-origin-resource-policy', 'cross-origin')
      .send(file)
  }
}
