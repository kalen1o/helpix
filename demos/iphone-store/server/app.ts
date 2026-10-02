import { createHash, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import type { Order, OrderItem } from '@helpix/shared/orders'
import { formatCapacity, productById } from '../src/products'
import { ShopError } from './errors'
import { hashPassword, verifyPassword } from './passwords'
import { loadSecrets } from './secrets'
import { clearedSessionCookie, parseCookies, readSession, SESSION_COOKIE, sessionCookie, signSession } from './session'
import { openStore, type CustomerRecord, type StoredOrder } from './store'
import { mintHelpixToken } from './token'

export interface AppOptions {
  dataDir: string
  seedDir: string
  logger?: boolean
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LIST_DEFAULT = 5
const LIST_MAX = 20
const MAX_LINES = 20

const credentialsSchema = (fields: string[]) => ({
  body: {
    type: 'object',
    required: fields,
    properties: Object.fromEntries(fields.map((f) => [f, { type: 'string', maxLength: 1000 }])),
  },
})

const publicCustomer = (c: CustomerRecord) => ({ id: c.id, name: c.name, email: c.email })

function toOrder({ customerId: _owner, ...order }: StoredOrder): Order {
  return order
}

/** Compares digests, so neither the length nor the content of the expected key leaks through timing. */
const sameSecret = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())

function invalidItems(message: string): ShopError {
  return new ShopError(400, 'invalid_items', message)
}

/** Bag lines → order items, checked against the catalogue. */
function toOrderItems(body: unknown): OrderItem[] {
  const lines = (body as { items?: unknown } | null)?.items
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_LINES) throw invalidItems(`Send 1 to ${MAX_LINES} bag lines.`)
  return lines.map((raw) => {
    const line = (raw ?? {}) as Record<string, unknown>
    const product = typeof line.productId === 'string' ? productById(line.productId) : undefined
    if (!product) throw invalidItems('Unknown product.')
    const color = line.color
    if (typeof color !== 'string' || !product.colors.some((c) => c.name === color)) throw invalidItems(`${product.name} doesn't come in that finish.`)
    const gb = line.gb
    if (typeof gb !== 'number' || !product.storage.some((s) => s.gb === gb)) throw invalidItems(`${product.name} doesn't come in that capacity.`)
    const quantity = line.quantity
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw invalidItems('Quantity must be 1 to 10.')
    return { name: product.name, quantity, variant: gb ? `${color} · ${formatCapacity(gb)}` : color }
  })
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const store = await openStore(opts)
  // Hashed once; a login for an unknown email checks against it so it takes as long as a wrong password.
  const dummyHash = hashPassword('orchard-no-such-account')
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 64 * 1024 })

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof ShopError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) } })
    }
    if (err.validation || (err.statusCode && err.statusCode >= 400 && err.statusCode < 500)) {
      return reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 400).send({ error: { code: 'invalid_request', message: err.message } })
    }
    req.log.error({ err }, 'request failed')
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Something went wrong.' } })
  })
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } }))

  async function currentCustomer(req: FastifyRequest, reply: FastifyReply): Promise<CustomerRecord | null> {
    const value = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    if (!value) return null
    const { sessionSecret } = await loadSecrets(opts.dataDir)
    const id = readSession(value, sessionSecret)
    const customer = id ? store.customerById(id) : undefined
    if (!customer) reply.header('set-cookie', clearedSessionCookie())
    return customer ?? null
  }

  // ---- Shopper API (same origin through the Vite proxy) ----

  app.post<{ Body: { name: string; email: string; password: string } }>(
    '/api/signup',
    { schema: credentialsSchema(['name', 'email', 'password']) },
    async (req, reply) => {
      const { sessionSecret } = await loadSecrets(opts.dataDir)
      const name = req.body.name.trim()
      if (name.length < 1 || name.length > 80) throw new ShopError(400, 'invalid_name', 'Enter your name (up to 80 characters).', 'name')
      const email = req.body.email.trim().toLowerCase()
      if (email.length > 254 || !EMAIL_RE.test(email)) throw new ShopError(400, 'invalid_email', 'Enter a valid email address.', 'email')
      if (req.body.password.length < 8) throw new ShopError(400, 'weak_password', 'Use at least 8 characters.', 'password')
      if (store.customerByEmail(email)) throw new ShopError(409, 'email_taken', 'An account with that email already exists.', 'email')
      const customer = await store.addCustomer({ name, email, passwordHash: await hashPassword(req.body.password) })
      reply.header('set-cookie', sessionCookie(signSession(customer.id, sessionSecret)))
      return reply.code(201).send({ customer: publicCustomer(customer) })
    },
  )

  app.post<{ Body: { email: string; password: string } }>('/api/login', { schema: credentialsSchema(['email', 'password']) }, async (req, reply) => {
    const { sessionSecret } = await loadSecrets(opts.dataDir)
    const customer = store.customerByEmail(req.body.email.trim().toLowerCase())
    const ok = await verifyPassword(req.body.password, customer?.passwordHash ?? (await dummyHash))
    if (!customer || !ok) throw new ShopError(401, 'invalid_credentials', 'Email or password is incorrect')
    reply.header('set-cookie', sessionCookie(signSession(customer.id, sessionSecret)))
    return { customer: publicCustomer(customer) }
  })

  app.post('/api/logout', async (_req, reply) => {
    reply.header('set-cookie', clearedSessionCookie())
    return reply.code(204).send()
  })

  app.get('/api/me', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    const customer = await currentCustomer(req, reply)
    if (!customer) return { customer: null }
    const { privateKeyPem, widgetKey } = await loadSecrets(opts.dataDir)
    const helpixToken = await mintHelpixToken({ privateKeyPem, customerId: customer.id, widgetKey })
    return { customer: publicCustomer(customer), helpixToken }
  })

  app.post('/api/checkout', async (req, reply) => {
    const customer = await currentCustomer(req, reply)
    if (!customer) throw new ShopError(401, 'not_signed_in', 'Sign in to check out.')
    const order = await store.placeOrder(customer.id, toOrderItems(req.body))
    return reply.code(201).send({ orderId: order.orderId })
  })

  // ---- Order API (the contract Helpix calls; spec 4b §3.3) ----

  async function requireOrderApiKey(req: FastifyRequest): Promise<void> {
    const { orderApiKey } = await loadSecrets(opts.dataDir)
    const auth = req.headers.authorization ?? ''
    const given = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
    if (!given || !sameSecret(given, orderApiKey)) throw new ShopError(401, 'unauthorized', 'Missing or wrong API key.')
  }

  function customerIdOf(req: FastifyRequest): string {
    const id = req.headers['x-customer-id']
    if (typeof id !== 'string' || id.length < 1 || id.length > 200) throw new ShopError(400, 'missing_customer', 'X-Customer-Id is required.')
    return id
  }

  app.get<{ Params: { orderId: string } }>('/orders/:orderId', { preHandler: requireOrderApiKey }, async (req) => {
    // Another customer's order gets the same 404 as an unknown one (Review Focus #1).
    const order = store.orderOf(customerIdOf(req), req.params.orderId)
    if (!order) throw new ShopError(404, 'order_not_found', 'No such order.')
    return toOrder(order)
  })

  app.get<{ Querystring: { limit?: string } }>('/orders', { preHandler: requireOrderApiKey }, async (req) => {
    const customerId = customerIdOf(req)
    const n = Number.parseInt(req.query.limit ?? '', 10)
    const limit = Number.isFinite(n) ? Math.min(Math.max(n, 1), LIST_MAX) : LIST_DEFAULT
    return { orders: store.ordersOf(customerId, limit).map(toOrder) }
  })

  return app
}
