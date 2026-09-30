import { AppError, isUniqueViolation, type Db } from '@helpix/shared'
import type { TenantStatus, TenantView } from '@helpix/shared/api-types'
import { newWidgetKey } from '../lib/tokens'

interface TenantRow {
  id: string
  name: string
  slug: string
  status: TenantStatus
  widget_key: string
  allowed_origins: string[]
  created_at: Date
}

const COLUMNS = 'id, name, slug, status, widget_key, allowed_origins, created_at'

function toView(r: TenantRow): TenantView {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    widgetKey: r.widget_key,
    allowedOrigins: r.allowed_origins,
    createdAt: r.created_at.toISOString(),
  }
}

function one(rows: TenantRow[]): TenantView | null {
  return rows[0] ? toView(rows[0]) : null
}

export async function createTenant(db: Db, input: { name: string; slug: string }): Promise<TenantView> {
  try {
    const { rows } = await db.query<TenantRow>(
      `INSERT INTO tenant_auth.tenants (name, slug, widget_key) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      [input.name, input.slug, newWidgetKey()],
    )
    return toView(rows[0]!)
  } catch (e) {
    if (isUniqueViolation(e, 'tenants_slug_key')) throw new AppError(409, 'slug_taken', `Slug "${input.slug}" is already in use`)
    throw e
  }
}

export async function listTenants(db: Db): Promise<TenantView[]> {
  const { rows } = await db.query<TenantRow>(`SELECT ${COLUMNS} FROM tenant_auth.tenants ORDER BY created_at DESC, id`)
  return rows.map(toView)
}

export async function getTenant(db: Db, id: string): Promise<TenantView | null> {
  const { rows } = await db.query<TenantRow>(`SELECT ${COLUMNS} FROM tenant_auth.tenants WHERE id = $1`, [id])
  return one(rows)
}

export async function updateTenant(
  db: Db,
  id: string,
  patch: { name?: string; allowedOrigins?: string[] },
): Promise<TenantView | null> {
  const { rows } = await db.query<TenantRow>(
    `UPDATE tenant_auth.tenants
       SET name = COALESCE($2, name), allowed_origins = COALESCE($3, allowed_origins), updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, patch.name ?? null, patch.allowedOrigins ?? null],
  )
  return one(rows)
}

export async function setTenantStatus(db: Db, id: string, status: TenantStatus): Promise<TenantView | null> {
  const { rows } = await db.query<TenantRow>(
    `UPDATE tenant_auth.tenants SET status = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, status],
  )
  return one(rows)
}

export async function rotateWidgetKey(db: Db, id: string): Promise<TenantView | null> {
  const { rows } = await db.query<TenantRow>(
    `UPDATE tenant_auth.tenants SET widget_key = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, newWidgetKey()],
  )
  return one(rows)
}

export async function findTenantByWidgetKey(db: Db, widgetKey: string): Promise<TenantView | null> {
  const { rows } = await db.query<TenantRow>(`SELECT ${COLUMNS} FROM tenant_auth.tenants WHERE widget_key = $1`, [widgetKey])
  return one(rows)
}
