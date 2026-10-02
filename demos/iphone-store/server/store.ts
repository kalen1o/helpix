import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Order, OrderItem } from '@helpix/shared/orders'
import { ShopError } from './errors'
import { hashPassword } from './passwords'

export interface CustomerRecord {
  id: string
  name: string
  email: string
  passwordHash: string
  createdAt: string
}

/** An order as the shop stores it: the contract fields plus its owner. The owner never goes out on the order API. */
export interface StoredOrder extends Order {
  customerId: string
}

interface SeedCustomer {
  id: string
  name: string
  email: string
  password: string
}

export interface Store {
  customerByEmail(email: string): CustomerRecord | undefined
  customerById(id: string): CustomerRecord | undefined
  /** Throws 409 `email_taken` when the (already lowercased) email has an account. */
  addCustomer(input: { name: string; email: string; passwordHash: string }): Promise<CustomerRecord>
  /** The customer's orders, newest first. */
  ordersOf(customerId: string, limit: number): StoredOrder[]
  /** The order only when this customer owns it. */
  orderOf(customerId: string, orderId: string): StoredOrder | undefined
  /** A `processing` order numbered after the highest existing one. */
  placeOrder(customerId: string, items: OrderItem[], now?: Date): Promise<StoredOrder>
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Write to a temp file in the same folder, then rename over the target, so a crash never leaves half a file. */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`)
  await rename(tmp, path)
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function loadOrCreate<T>(path: string, create: () => Promise<T>): Promise<T> {
  try {
    return await readJson<T>(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  const value = await create()
  await writeJsonAtomic(path, value)
  return value
}

const newestFirst = (a: StoredOrder, b: StoredOrder) => b.placedAt.localeCompare(a.placedAt) || Number(b.orderId) - Number(a.orderId)

/**
 * Customers and orders live in `.data/customers.json` and `.data/orders.json`, held in memory and written through on
 * every change. The first start creates them from `seed/`, hashing the seed passwords.
 */
export async function openStore(opts: { dataDir: string; seedDir: string }): Promise<Store> {
  await mkdir(opts.dataDir, { recursive: true })
  const customersPath = join(opts.dataDir, 'customers.json')
  const ordersPath = join(opts.dataDir, 'orders.json')

  const customers = await loadOrCreate<CustomerRecord[]>(customersPath, async () => {
    const seed = await readJson<SeedCustomer[]>(join(opts.seedDir, 'customers.json'))
    const createdAt = new Date().toISOString()
    return Promise.all(
      seed.map(async (c) => ({ id: c.id, name: c.name, email: c.email.toLowerCase(), passwordHash: await hashPassword(c.password), createdAt })),
    )
  })
  const orders = await loadOrCreate<StoredOrder[]>(ordersPath, () => readJson<StoredOrder[]>(join(opts.seedDir, 'orders.json')))

  // One write at a time, in order; a failed write does not block the next one.
  let queue: Promise<unknown> = Promise.resolve()
  const persist = (path: string, data: unknown): Promise<void> => {
    const run = queue.then(() => writeJsonAtomic(path, data))
    queue = run.catch(() => undefined)
    return run
  }

  return {
    customerByEmail: (email) => customers.find((c) => c.email === email),
    customerById: (id) => customers.find((c) => c.id === id),

    async addCustomer(input) {
      // Checked again here, synchronously before the push: two sign-ups may have hashed their passwords concurrently.
      if (customers.some((c) => c.email === input.email)) {
        throw new ShopError(409, 'email_taken', 'An account with that email already exists.', 'email')
      }
      const customer: CustomerRecord = { id: `cust_${randomBytes(6).toString('hex')}`, ...input, createdAt: new Date().toISOString() }
      customers.push(customer)
      await persist(customersPath, customers)
      return customer
    },

    ordersOf: (customerId, limit) => orders.filter((o) => o.customerId === customerId).sort(newestFirst).slice(0, limit),
    orderOf: (customerId, orderId) => orders.find((o) => o.orderId === orderId && o.customerId === customerId),

    async placeOrder(customerId, items, now = new Date()) {
      const next = orders.reduce((max, o) => Math.max(max, Number.parseInt(o.orderId, 10) || 0), 1000) + 1
      const at = now.toISOString()
      const order: StoredOrder = {
        customerId,
        orderId: String(next),
        status: 'processing',
        placedAt: at,
        updatedAt: at,
        items,
        eta: new Date(now.getTime() + 2 * DAY_MS).toISOString(),
        note: 'Demo order: no payment was taken and nothing ships.',
      }
      orders.push(order)
      await persist(ordersPath, orders)
      return order
    },
  }
}
