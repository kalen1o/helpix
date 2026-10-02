// @vitest-environment node
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parseOrder } from '@helpix/shared/orders'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../passwords'
import { parseCookies, readSession, signSession } from '../session'
import { openStore, type StoredOrder } from '../store'
import { makeDataDir, SEED_DIR } from './helpers'

let dataDir: string
beforeEach(async () => {
  dataDir = await makeDataDir()
})
afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

const contract = ({ customerId: _owner, ...order }: StoredOrder) => order

describe('passwords', () => {
  it('hashes with scrypt, a 16-byte salt and a 64-byte key, and verifies', async () => {
    const stored = await hashPassword('orchard-demo')
    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/)
    expect(await verifyPassword('orchard-demo', stored)).toBe(true)
    expect(await verifyPassword('orchard-demO', stored)).toBe(false)
  })

  it('salts every hash and rejects malformed stored values', async () => {
    expect(await hashPassword('same-password')).not.toBe(await hashPassword('same-password'))
    expect(await verifyPassword('x', 'plain-text')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$00$00')).toBe(false)
  })
})

describe('session cookie', () => {
  it('round-trips and rejects a tampered value or another secret', () => {
    const value = signSession('cust_maya', 'secret-a')
    expect(value).toMatch(/^cust_maya\.[A-Za-z0-9_-]+$/)
    expect(readSession(value, 'secret-a')).toBe('cust_maya')
    expect(readSession(value.replace('cust_maya', 'cust_leo'), 'secret-a')).toBeNull()
    expect(readSession(value, 'secret-b')).toBeNull()
    expect(readSession('garbage', 'secret-a')).toBeNull()
    expect(readSession(undefined, 'secret-a')).toBeNull()
  })

  it('parses a Cookie header', () => {
    expect(parseCookies('a=1; orchard_session=cust_x.abc; b=two')).toEqual({ a: '1', orchard_session: 'cust_x.abc', b: 'two' })
    expect(parseCookies(undefined)).toEqual({})
  })
})

describe('store', () => {
  it('creates customers.json from the seed with hashed passwords only', async () => {
    const store = await openStore({ dataDir, seedDir: SEED_DIR })
    const raw = await readFile(join(dataDir, 'customers.json'), 'utf8')
    expect(raw).not.toContain('orchard-demo')
    const maya = store.customerByEmail('maya@orchard.demo')!
    expect(maya.id).toBe('cust_maya')
    expect(maya.passwordHash).toMatch(/^scrypt\$/)
    expect(await verifyPassword('orchard-demo', maya.passwordHash)).toBe(true)
    expect(store.customerById('cust_leo')?.email).toBe('leo@orchard.demo')
    expect(store.customerById('cust_ana')?.email).toBe('ana@orchard.demo')
  })

  it('keeps existing data files on the next start', async () => {
    const first = await openStore({ dataDir, seedDir: SEED_DIR })
    const hash = first.customerById('cust_maya')!.passwordHash
    await first.placeOrder('cust_maya', [{ name: 'Orchard Buds', quantity: 1, variant: 'Snow' }])
    const second = await openStore({ dataDir, seedDir: SEED_DIR })
    expect(second.customerById('cust_maya')!.passwordHash).toBe(hash)
    expect(second.orderOf('cust_maya', '1009')?.status).toBe('processing')
  })

  it('seeds orders 1001-1008 that satisfy the Order contract and cover every lifecycle state', async () => {
    const seed = JSON.parse(await readFile(join(SEED_DIR, 'orders.json'), 'utf8')) as StoredOrder[]
    expect(seed.map((o) => o.orderId)).toEqual(['1001', '1002', '1003', '1004', '1005', '1006', '1007', '1008'])
    for (const o of seed) {
      expect(parseOrder(contract(o)), `order ${o.orderId}`).not.toBeNull()
      expect(['cust_maya', 'cust_leo', 'cust_ana']).toContain(o.customerId)
    }
    expect(new Set(seed.map((o) => o.status))).toEqual(new Set(['processing', 'shipped', 'delivered', 'cancelled', 'returned']))
    expect(seed.filter((o) => o.status === 'shipped').every((o) => o.tracking?.url && o.eta)).toBe(true)
  })

  it('numbers new orders after the highest existing one and writes atomically', async () => {
    const store = await openStore({ dataDir, seedDir: SEED_DIR })
    const now = new Date('2026-10-02T12:00:00.000Z')
    const a = await store.placeOrder('cust_ana', [{ name: 'Orchard Mini', quantity: 1, variant: 'Ink · 128 GB' }], now)
    const b = await store.placeOrder('cust_ana', [{ name: 'Orchard Buds', quantity: 2, variant: 'Snow' }], now)
    expect([a.orderId, b.orderId]).toEqual(['1009', '1010'])
    expect(a).toMatchObject({ status: 'processing', placedAt: now.toISOString(), updatedAt: now.toISOString(), customerId: 'cust_ana' })
    expect(parseOrder(contract(a))).not.toBeNull()
    const files = await readdir(dataDir)
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([])
    const onDisk = JSON.parse(await readFile(join(dataDir, 'orders.json'), 'utf8')) as StoredOrder[]
    expect(onDisk.map((o) => o.orderId)).toContain('1010')
  })

  it('lists one customer’s orders newest first', async () => {
    const store = await openStore({ dataDir, seedDir: SEED_DIR })
    expect(store.ordersOf('cust_maya', 10).map((o) => o.orderId)).toEqual(['1008', '1006', '1001'])
    expect(store.ordersOf('cust_maya', 1).map((o) => o.orderId)).toEqual(['1008'])
    expect(store.orderOf('cust_leo', '1001')).toBeUndefined()
  })
})
