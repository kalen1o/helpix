import { PassThrough, type Readable } from 'node:stream'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { request, type Dispatcher } from 'undici'
import { AppError, HEADERS, IDENTITY_HEADERS } from '@helpix/shared'
import { upstreamUrl } from './path'

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
])
const STRIP_FROM_CLIENT = new Set([...IDENTITY_HEADERS, 'authorization', HEADERS.requestId])

export interface ForwardOptions {
  target: string
  /** Prefix of the matched route (e.g. `/auth`); the forwarded path must stay under it. */
  routePrefix: string
  /** The validated path and raw query string from `canonicalPath()`; forwarded instead of `req.url`. */
  path: { pathname: string; search: string }
  internalToken: string
  identity?: Record<string, string>
}

export function enforceBodyLimit(limit: number | ((req: FastifyRequest) => number)) {
  return async (req: FastifyRequest): Promise<void> => {
    const max = typeof limit === 'number' ? limit : limit(req)
    const len = req.headers['content-length']
    if (len !== undefined && Number(len) > max) {
      throw new AppError(413, 'payload_too_large', `Request body exceeds ${max} bytes`)
    }
    if (len === undefined && req.headers['transfer-encoding']) {
      throw new AppError(411, 'length_required', 'Content-Length is required')
    }
  }
}

export async function forward(req: FastifyRequest, reply: FastifyReply, opts: ForwardOptions): Promise<FastifyReply> {
  const url = upstreamUrl(opts.target, opts.path, opts.routePrefix)
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name) || STRIP_FROM_CLIENT.has(name)) continue
    headers[name] = Array.isArray(value) ? value.join(', ') : value
  }
  Object.assign(headers, opts.identity)
  headers[HEADERS.internalToken] = opts.internalToken
  headers[HEADERS.requestId] = req.id

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body != null
  // Pipe through a PassThrough: on connection failure undici destroys the body stream with the error, and
  // destroying the raw request stream would abort Fastify's response before the 502 can be sent.
  let body: PassThrough | undefined
  if (hasBody) {
    body = new PassThrough()
    body.on('error', () => {})
    const src = req.body as Readable
    src.pipe(body)
    // pipe() does not propagate source failure; forward it one way only (never destroy the source).
    src.once('error', (e) => body!.destroy(e))
    src.once('close', () => {
      if (!src.readableEnded) body!.destroy(new Error('client aborted request body'))
    })
  }
  let upstream: Dispatcher.ResponseData
  try {
    upstream = await request(url, {
      method: req.method as Dispatcher.HttpMethod,
      headers,
      body,
    })
  } catch (err) {
    req.log.error({ err, target: opts.target }, 'upstream request failed')
    throw new AppError(502, 'upstream_unavailable', 'A backend service is unavailable')
  }

  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name)) reply.header(name, value)
  }
  reply.code(upstream.statusCode)
  if (upstream.statusCode === 204 || upstream.statusCode === 304) {
    await upstream.body.dump()
    return reply.send()
  }
  return reply.send(upstream.body)
}
