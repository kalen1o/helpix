import { AppError, isUniqueViolation, type Db } from '@helpix/shared'
import type { AdminView, Role } from '@helpix/shared/api-types'

export interface AdminRow {
  id: string
  tenant_id: string | null
  email: string
  password_hash: string
  role: Role
  created_at: Date
}

const COLUMNS = 'id, tenant_id, email, password_hash, role, created_at'

export function toAdminView(r: AdminRow): AdminView {
  return { id: r.id, tenantId: r.tenant_id, email: r.email, role: r.role, createdAt: r.created_at.toISOString() }
}

/** `email` must already be normalized. */
export async function findAdminByEmail(db: Db, email: string): Promise<AdminRow | null> {
  const { rows } = await db.query<AdminRow>(`SELECT ${COLUMNS} FROM tenant_auth.admins WHERE email = $1`, [email])
  return rows[0] ?? null
}

export async function findAdminById(db: Db, id: string): Promise<AdminRow | null> {
  const { rows } = await db.query<AdminRow>(`SELECT ${COLUMNS} FROM tenant_auth.admins WHERE id = $1`, [id])
  return rows[0] ?? null
}

export async function createAdmin(
  db: Db,
  input: { email: string; passwordHash: string; role: Role; tenantId: string | null },
): Promise<AdminRow> {
  try {
    const { rows } = await db.query<AdminRow>(
      `INSERT INTO tenant_auth.admins (email, password_hash, role, tenant_id) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [input.email, input.passwordHash, input.role, input.tenantId],
    )
    return rows[0]!
  } catch (e) {
    if (isUniqueViolation(e, 'admins_email_key')) throw new AppError(409, 'email_taken', 'An admin with this email already exists')
    throw e
  }
}

export async function listTenantAdmins(db: Db, tenantId: string): Promise<AdminRow[]> {
  const { rows } = await db.query<AdminRow>(
    `SELECT ${COLUMNS} FROM tenant_auth.admins WHERE tenant_id = $1 ORDER BY created_at, id`,
    [tenantId],
  )
  return rows
}
