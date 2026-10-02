import type { Db } from '@helpix/shared'
import type { IntegrationsView } from '@helpix/shared/api-types'

export interface IntegrationsRow {
  shop_key_pem: string | null
  shop_key_fingerprint: string | null
  shop_key_updated_at: Date | null
  order_api_base_url: string | null
  order_api_key_enc: string | null
  order_api_updated_at: Date | null
}

const COLUMNS =
  'shop_key_pem, shop_key_fingerprint, shop_key_updated_at, order_api_base_url, order_api_key_enc, order_api_updated_at'

export async function getIntegrations(db: Db, tenantId: string): Promise<IntegrationsRow | null> {
  const { rows } = await db.query<IntegrationsRow>(`SELECT ${COLUMNS} FROM tenant_auth.integrations WHERE tenant_id = $1`, [tenantId])
  return rows[0] ?? null
}

export async function setShopKey(db: Db, tenantId: string, pem: string, fingerprint: string): Promise<IntegrationsRow> {
  const { rows } = await db.query<IntegrationsRow>(
    `INSERT INTO tenant_auth.integrations (tenant_id, shop_key_pem, shop_key_fingerprint, shop_key_updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       shop_key_pem = EXCLUDED.shop_key_pem,
       shop_key_fingerprint = EXCLUDED.shop_key_fingerprint,
       shop_key_updated_at = now(),
       updated_at = now()
     RETURNING ${COLUMNS}`,
    [tenantId, pem, fingerprint],
  )
  return rows[0]!
}

export async function clearShopKey(db: Db, tenantId: string): Promise<void> {
  await db.query(
    `UPDATE tenant_auth.integrations
        SET shop_key_pem = NULL, shop_key_fingerprint = NULL, shop_key_updated_at = NULL, updated_at = now()
      WHERE tenant_id = $1`,
    [tenantId],
  )
}

/**
 * Saves the order API. `keyEnc` null keeps the stored key; then it returns null (and saves nothing) when no key is stored.
 * The null-key path is one guarded UPDATE, so a concurrent clear cannot leave a URL without a key.
 */
export async function setOrderApi(db: Db, tenantId: string, baseUrl: string, keyEnc: string | null): Promise<IntegrationsRow | null> {
  if (keyEnc === null) {
    const { rows } = await db.query<IntegrationsRow>(
      `UPDATE tenant_auth.integrations
          SET order_api_base_url = $2, order_api_updated_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND order_api_key_enc IS NOT NULL
        RETURNING ${COLUMNS}`,
      [tenantId, baseUrl],
    )
    return rows[0] ?? null
  }
  const { rows } = await db.query<IntegrationsRow>(
    `INSERT INTO tenant_auth.integrations (tenant_id, order_api_base_url, order_api_key_enc, order_api_updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       order_api_base_url = EXCLUDED.order_api_base_url,
       order_api_key_enc = EXCLUDED.order_api_key_enc,
       order_api_updated_at = now(),
       updated_at = now()
     RETURNING ${COLUMNS}`,
    [tenantId, baseUrl, keyEnc],
  )
  return rows[0]!
}

export async function clearOrderApi(db: Db, tenantId: string): Promise<void> {
  await db.query(
    `UPDATE tenant_auth.integrations
        SET order_api_base_url = NULL, order_api_key_enc = NULL, order_api_updated_at = NULL, updated_at = now()
      WHERE tenant_id = $1`,
    [tenantId],
  )
}

/** The admin view. Never includes the key, only whether one is stored. */
export function toIntegrationsView(row: IntegrationsRow | null): IntegrationsView {
  return {
    orderApi:
      row?.order_api_base_url && row.order_api_updated_at
        ? { baseUrl: row.order_api_base_url, hasApiKey: row.order_api_key_enc !== null, updatedAt: row.order_api_updated_at.toISOString() }
        : null,
    shopKey:
      row?.shop_key_fingerprint && row.shop_key_updated_at
        ? { fingerprint: row.shop_key_fingerprint, updatedAt: row.shop_key_updated_at.toISOString() }
        : null,
  }
}
