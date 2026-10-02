import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import Fastify from 'fastify'

/** A valid order in the shop contract. */
export const SAMPLE_ORDER = {
  orderId: '1001',
  status: 'shipped',
  placedAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-22T08:30:00.000Z',
  items: [{ name: 'iPhone 15', quantity: 1, variant: 'Blue · 128 GB' }],
  eta: '2026-09-25',
  tracking: { carrier: 'UPS', number: '1Z999', url: 'https://ups.example/track/1Z999' },
} as const

export interface ShopRequest {
  /** Raw (still percent-encoded) path, e.g. `/a/orders/A%201`. */
  path: string
  /** Raw query string including `?`, or ''. */
  query: string
  authorization: string | undefined
  customerId: string | undefined
  accept: string | undefined
}

export interface ShopReply {
  status?: number
  json?: unknown
  /** Sent as-is with `contentType` (default text/html). */
  raw?: string
  contentType?: string
  location?: string
  delayMs?: number
  /** Streamed as chunks with no content-length. */
  chunks?: string[]
}

export interface FakeShop {
  url: string
  requests: ShopRequest[]
  reply(fn: (req: ShopRequest) => ShopReply): void
  close(): Promise<void>
}

/** A real HTTP shop on 127.0.0.1 with a random port. Every GET is recorded and answered by the current handler. */
export async function startFakeShop(): Promise<FakeShop> {
  const app = Fastify({ logger: false })
  const requests: ShopRequest[] = []
  let handler: (req: ShopRequest) => ShopReply = () => ({ status: 404, json: { error: 'not_found' } })

  app.get('/*', async (req, reply) => {
    const u = new URL(req.url, 'http://fake-shop')
    const header = (name: string) => {
      const v = req.headers[name]
      return typeof v === 'string' ? v : undefined
    }
    const r: ShopRequest = {
      path: u.pathname,
      query: u.search,
      authorization: header('authorization'),
      customerId: header('x-customer-id'),
      accept: header('accept'),
    }
    requests.push(r)
    const out = handler(r)
    if (out.delayMs) await new Promise((resolve) => setTimeout(resolve, out.delayMs))
    reply.code(out.status ?? 200)
    if (out.location) reply.header('location', out.location)
    if (out.chunks) return reply.type('application/json').send(Readable.from(out.chunks))
    if (out.raw !== undefined) return reply.type(out.contentType ?? 'text/html').send(out.raw)
    return reply.type('application/json').send(JSON.stringify(out.json ?? {}))
  })

  await app.listen({ port: 0, host: '127.0.0.1' })
  const { port } = app.server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    reply: (fn) => {
      handler = fn
    },
    close: () => app.close(),
  }
}
