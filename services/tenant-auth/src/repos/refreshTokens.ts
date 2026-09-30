import type { Db } from '@helpix/shared'

export async function insertRefreshToken(db: Db, adminId: string, hash: string, expiresAt: Date): Promise<void> {
  await db.query(
    'INSERT INTO tenant_auth.refresh_tokens (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [adminId, hash, expiresAt],
  )
}

/** Atomically marks a live token as used. Returns its admin id, or null if it was unknown, used, revoked or expired. */
export async function consumeRefreshToken(db: Db, hash: string): Promise<string | null> {
  const { rows } = await db.query<{ admin_id: string }>(
    `UPDATE tenant_auth.refresh_tokens SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
     RETURNING admin_id`,
    [hash],
  )
  return rows[0]?.admin_id ?? null
}

export async function revokeRefreshToken(db: Db, hash: string): Promise<void> {
  await db.query('UPDATE tenant_auth.refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hash])
}
