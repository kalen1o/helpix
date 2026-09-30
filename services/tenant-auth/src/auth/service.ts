import { AppError, type Db } from '@helpix/shared'
import type { SessionResponse } from '@helpix/shared/api-types'
import type { RouteDeps } from '../deps'
import { normalizeEmail } from '../lib/email'
import { DUMMY_HASH, verifyPassword } from '../lib/passwords'
import { hashToken, newRefreshToken } from '../lib/tokens'
import { findAdminByEmail, findAdminById, toAdminView, type AdminRow } from '../repos/admins'
import { consumeRefreshToken, insertRefreshToken, revokeRefreshToken } from '../repos/refreshTokens'
import { getTenant } from '../repos/tenants'

export async function assertAdminActive(db: Db, admin: AdminRow): Promise<void> {
  if (!admin.tenant_id) return
  const tenant = await getTenant(db, admin.tenant_id)
  if (!tenant || tenant.status !== 'active') {
    throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
  }
}

async function issueSession(deps: RouteDeps, admin: AdminRow): Promise<SessionResponse> {
  const accessToken = await deps.tokens.signAccess({ adminId: admin.id, role: admin.role, tenantId: admin.tenant_id })
  const refresh = newRefreshToken()
  const expiresAt = new Date(Date.now() + deps.config.refreshTtlDays * 24 * 60 * 60 * 1000)
  await insertRefreshToken(deps.db, admin.id, refresh.hash, expiresAt)
  return { accessToken, refreshToken: refresh.token, admin: toAdminView(admin) }
}

export async function login(deps: RouteDeps, email: string, password: string): Promise<SessionResponse> {
  const admin = await findAdminByEmail(deps.db, normalizeEmail(email))
  const ok = await verifyPassword(password, admin?.password_hash ?? DUMMY_HASH)
  if (!admin || !ok) throw new AppError(401, 'invalid_credentials', 'Invalid email or password')
  await assertAdminActive(deps.db, admin)
  return issueSession(deps, admin)
}

export async function refreshSession(deps: RouteDeps, refreshToken: string): Promise<SessionResponse> {
  const adminId = await consumeRefreshToken(deps.db, hashToken(refreshToken))
  const admin = adminId ? await findAdminById(deps.db, adminId) : null
  if (!admin) throw new AppError(401, 'invalid_refresh_token', 'Session expired, please log in again')
  await assertAdminActive(deps.db, admin)
  return issueSession(deps, admin)
}

export async function logout(deps: RouteDeps, refreshToken: string): Promise<void> {
  await revokeRefreshToken(deps.db, hashToken(refreshToken))
}
