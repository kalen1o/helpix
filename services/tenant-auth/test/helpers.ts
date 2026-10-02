import { fileURLToPath } from 'node:url'
import { createPool, HEADERS, INTERNAL_CALLER_CHAT, INTERNAL_CALLER_RESOLVER, migrate, type Db } from '@helpix/shared'
import type { AdminView, Role, TenantStatus, TenantView } from '@helpix/shared/api-types'
import { TEST_DATABASE_URL } from '@helpix/shared/testing'
import { exportSPKI, generateKeyPair, SignJWT, type CryptoKey } from 'jose'
import { buildApp } from '../src/app'
import type { Config } from '../src/config'
import { hashPassword } from '../src/lib/passwords'
import type { ShopClient } from '../src/lib/shopClient'
import { createAdmin, toAdminView } from '../src/repos/admins'
import { createTenant, setTenantStatus, updateTenant } from '../src/repos/tenants'

export const TEST_CONFIG: Config = {
  port: 0,
  databaseUrl: TEST_DATABASE_URL,
  internalToken: 'tenant-auth-test-internal-token-0123456789',
  adminJwtSecret: 'test-secret-test-secret-test-secret-1234',
  accessTtl: '15m',
  refreshTtlDays: 30,
  secretsMasterKey: Buffer.alloc(32, 7),
  // Tests talk to a fake shop on 127.0.0.1. The blocking path is tested with this set to false explicitly.
  orderApiAllowPrivateHosts: true,
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url))

export async function setupTestDb(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL)
  await migrate(db, { schema: 'tenant_auth', dir: MIGRATIONS_DIR })
  return db
}

export async function resetDb(db: Db): Promise<void> {
  await db.query('TRUNCATE tenant_auth.integrations, tenant_auth.agent_configs, tenant_auth.refresh_tokens, tenant_auth.admins, tenant_auth.tenants CASCADE')
}

export function buildTestApp(db: Db, opts: { config?: Partial<Config>; shop?: ShopClient } = {}) {
  return buildApp({ db, config: { ...TEST_CONFIG, ...opts.config }, shop: opts.shop, logger: false })
}

export function internalHeaders(): Record<string, string> {
  return { [HEADERS.internalToken]: TEST_CONFIG.internalToken }
}

/** Headers the gateway's resolver client sends to `/internal/*`. */
export function resolverHeaders(): Record<string, string> {
  return { ...internalHeaders(), [HEADERS.internalCaller]: INTERNAL_CALLER_RESOLVER }
}

/** Headers chat-service sends to `/internal/agent-config/*`. */
export function chatCallerHeaders(): Record<string, string> {
  return { ...internalHeaders(), [HEADERS.internalCaller]: INTERNAL_CALLER_CHAT }
}

export function superAdminHeaders(adminId: string): Record<string, string> {
  return { ...internalHeaders(), [HEADERS.role]: 'super_admin', [HEADERS.adminId]: adminId }
}

export function tenantAdminHeaders(adminId: string, tenantId: string): Record<string, string> {
  return { ...internalHeaders(), [HEADERS.role]: 'tenant_admin', [HEADERS.adminId]: adminId, [HEADERS.tenantId]: tenantId }
}

export async function seedTenant(
  db: Db,
  input: { name?: string; slug: string; status?: TenantStatus; allowedOrigins?: string[] },
): Promise<TenantView> {
  let t = await createTenant(db, { name: input.name ?? input.slug, slug: input.slug })
  if (input.allowedOrigins) t = (await updateTenant(db, t.id, { allowedOrigins: input.allowedOrigins }))!
  if (input.status) t = (await setTenantStatus(db, t.id, input.status))!
  return t
}

export async function seedAdmin(
  db: Db,
  input: { email: string; password: string; role: Role; tenantId: string | null },
): Promise<AdminView> {
  const row = await createAdmin(db, {
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    tenantId: input.tenantId,
  })
  return toAdminView(row)
}

export interface ShopKeyPair {
  privateKey: CryptoKey
  publicPem: string
}

/** An RS256 key pair like a shop's. The private key is extractable so tests can re-import it for other algorithms. */
export async function newShopKeyPair(): Promise<ShopKeyPair> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  return { privateKey, publicPem: await exportSPKI(publicKey) }
}

export const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/** Valid shopper claims for `aud`; pass `{ exp: undefined }` etc. to drop a claim (JSON drops undefined). */
export function customerClaims(aud: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = nowSeconds()
  return { sub: 'cust_maya', aud, iat: now, exp: now + 600, ...over }
}

export function mintCustomerToken(privateKey: CryptoKey, claims: Record<string, unknown>, alg = 'RS256'): Promise<string> {
  return new SignJWT(claims).setProtectedHeader({ alg }).sign(privateKey)
}
