import { fileURLToPath } from 'node:url'
import { createPool, HEADERS, migrate, type Db } from '@helpix/shared'
import type { AdminView, Role, TenantStatus, TenantView } from '@helpix/shared/api-types'
import { TEST_DATABASE_URL } from '@helpix/shared/testing'
import { buildApp } from '../src/app'
import type { Config } from '../src/config'
import { hashPassword } from '../src/lib/passwords'
import { createAdmin, toAdminView } from '../src/repos/admins'
import { createTenant, setTenantStatus, updateTenant } from '../src/repos/tenants'

export const TEST_CONFIG: Config = {
  port: 0,
  databaseUrl: TEST_DATABASE_URL,
  internalToken: 'test-internal-token',
  adminJwtSecret: 'test-secret-test-secret-test-secret-1234',
  accessTtl: '15m',
  refreshTtlDays: 30,
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url))

export async function setupTestDb(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL)
  await migrate(db, { schema: 'tenant_auth', dir: MIGRATIONS_DIR })
  return db
}

export async function resetDb(db: Db): Promise<void> {
  await db.query('TRUNCATE tenant_auth.refresh_tokens, tenant_auth.admins, tenant_auth.tenants CASCADE')
}

export function buildTestApp(db: Db) {
  return buildApp({ db, config: TEST_CONFIG, logger: false })
}

export function internalHeaders(): Record<string, string> {
  return { [HEADERS.internalToken]: TEST_CONFIG.internalToken }
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
