import http from 'node:http'
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

/**
 * Sends a request with the path written verbatim on the request line. `inject()` and `fetch()` both run the
 * URL through WHATWG parsing, which resolves `..` and `%2e%2e` before the gateway sees them, so traversal
 * tests must go over a real socket.
 */
export function rawRequest(
  port: number,
  opts: { method: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: opts.method, path: opts.path, headers: opts.headers },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (text += c))
        res.on('end', () => resolve({ status: res.statusCode!, json: text ? JSON.parse(text) : null }))
      },
    )
    req.on('error', reject)
    req.end(opts.body)
  })
}

export const TEST_INTERNAL_TOKEN = 'gateway-test-internal-token-0123456789'

export function testConfig(tenantAuthUrl: string, kbServiceUrl: string = tenantAuthUrl, chatServiceUrl: string = tenantAuthUrl): GatewayConfig {
  return {
    port: 0,
    internalToken: TEST_INTERNAL_TOKEN,
    tenantAuthUrl,
    kbServiceUrl,
    chatServiceUrl,
    corsOrigins: ['http://localhost:5173'],
    bodyLimitBytes: 1024,
    kbUploadLimitBytes: 4096,
    resolveCacheTtlMs: 30_000,
  }
}
