import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import type { GatewayConfig } from '../src/config'

export interface EchoCall {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string | null
}

/** A fake upstream that records every request and replies `{ ok: true }` with an `x-upstream` header. */
export async function startEcho() {
  const calls: EchoCall[] = []
  const app = Fastify()
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body))
  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/*',
    handler: async (req, reply) => {
      calls.push({ method: req.method, url: req.url, headers: req.headers, body: (req.body as string | undefined) ?? null })
      reply.header('x-upstream', 'yes')
      return { ok: true }
    },
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const { port } = app.server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, calls, close: () => app.close() }
}

export function testConfig(tenantAuthUrl: string): GatewayConfig {
  return {
    port: 0,
    internalToken: 'internal-secret',
    tenantAuthUrl,
    corsOrigins: ['http://localhost:5173'],
    bodyLimitBytes: 1024,
    resolveCacheTtlMs: 30_000,
  }
}
