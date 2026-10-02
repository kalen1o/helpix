import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app'

export const SEED_DIR = fileURLToPath(new URL('../../seed', import.meta.url))
export const WIDGET_KEY = 'wk_test_orchard'
export const ORDER_API_KEY = 'test-order-api-key-0123456789'
export const PASSWORD = 'orchard-demo'

export const makeDataDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'orchard-'))

/** Writes the files `make seed-demos` would; returns the public key PEM. */
export async function writeSecrets(dataDir: string): Promise<string> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  await writeFile(join(dataDir, 'shop-key.pem'), privateKey)
  await writeFile(join(dataDir, 'shop-key.pub.pem'), publicKey)
  await writeFile(join(dataDir, 'order-api-key'), `${ORDER_API_KEY}\n`)
  await writeFile(join(dataDir, 'session-secret'), 'test-session-secret-0123456789abcdef')
  await writeFile(join(dataDir, 'widget-key'), `${WIDGET_KEY}\n`)
  return publicKey
}

export interface TestShop {
  app: FastifyInstance
  dataDir: string
  publicKeyPem: string
  close(): Promise<void>
}

export async function startShop(opts: { seeded?: boolean } = {}): Promise<TestShop> {
  const dataDir = await makeDataDir()
  const publicKeyPem = opts.seeded === false ? '' : await writeSecrets(dataDir)
  const app = await buildApp({ dataDir, seedDir: SEED_DIR })
  return {
    app,
    dataDir,
    publicKeyPem,
    close: async () => {
      await app.close()
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}

/** The `name=value` part of the first Set-Cookie header. */
export function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie']
  const first = String(Array.isArray(raw) ? raw[0] : raw)
  return first.split(';')[0]!
}

export function setCookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie']
  return String(Array.isArray(raw) ? raw[0] : raw)
}

export async function loginAs(app: FastifyInstance, email: string, password = PASSWORD): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { email, password } })
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`)
  return cookieOf(res)
}

export const orderApi = (customerId: string, key = ORDER_API_KEY) => ({ authorization: `Bearer ${key}`, 'x-customer-id': customerId })
