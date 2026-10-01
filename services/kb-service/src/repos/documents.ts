import { AppError, type Db } from '@helpix/shared'
import type { DocumentStatus, KbDocumentView } from '@helpix/shared/api-types'
import { storageKey } from '../storage'

export interface DocumentRow {
  id: string
  tenant_id: string
  title: string
  storage_key: string
  mime_type: string
  size_bytes: number
  status: DocumentStatus
  error: string | null
  embedding_model: string | null
  chunk_count: number
  created_at: Date
  updated_at: Date
}

const COLUMNS = `d.id, d.tenant_id, d.title, d.storage_key, d.mime_type, d.size_bytes, d.status, d.error, d.embedding_model,
  d.created_at, d.updated_at, (SELECT count(*) FROM kb.chunks c WHERE c.document_id = d.id)::int AS chunk_count`

export function toDocumentView(r: DocumentRow): KbDocumentView {
  return {
    id: r.id,
    title: r.title,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    status: r.status,
    error: r.error,
    chunkCount: r.chunk_count,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }
}

export function documentNotFound(): AppError {
  return new AppError(404, 'document_not_found', 'Document not found')
}

export async function insertDocument(
  db: Db,
  input: { id: string; tenantId: string; title: string; mimeType: string; sizeBytes: number; maxDocuments: number },
): Promise<DocumentRow> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    // Serialises inserts per tenant, so concurrent uploads cannot both pass the cap check.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kb.documents:${input.tenantId}`])
    const { rows } = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM kb.documents WHERE tenant_id = $1', [
      input.tenantId,
    ])
    if (rows[0]!.n >= input.maxDocuments) {
      throw new AppError(
        409,
        'document_limit_reached',
        `This knowledge base already has the maximum of ${input.maxDocuments} documents. Delete one first.`,
      )
    }
    await client.query(
      `INSERT INTO kb.documents (id, tenant_id, title, storage_key, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.id, input.tenantId, input.title, storageKey(input.tenantId, input.id), input.mimeType, input.sizeBytes],
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  return (await getDocument(db, input.tenantId, input.id))!
}

export async function listDocuments(db: Db, tenantId: string): Promise<DocumentRow[]> {
  const { rows } = await db.query<DocumentRow>(
    `SELECT ${COLUMNS} FROM kb.documents d WHERE d.tenant_id = $1 ORDER BY d.created_at DESC, d.id`,
    [tenantId],
  )
  return rows
}

export async function getDocument(db: Db, tenantId: string, id: string): Promise<DocumentRow | null> {
  const { rows } = await db.query<DocumentRow>(`SELECT ${COLUMNS} FROM kb.documents d WHERE d.tenant_id = $1 AND d.id = $2`, [
    tenantId,
    id,
  ])
  return rows[0] ?? null
}

export async function deleteDocument(db: Db, tenantId: string, id: string): Promise<{ storageKey: string } | null> {
  const { rows } = await db.query<{ storage_key: string }>(
    'DELETE FROM kb.documents WHERE tenant_id = $1 AND id = $2 RETURNING storage_key',
    [tenantId, id],
  )
  return rows[0] ? { storageKey: rows[0].storage_key } : null
}

export async function markProcessingForRetry(db: Db, tenantId: string, id: string): Promise<'ok' | 'not_found' | 'not_failed'> {
  const { rowCount } = await db.query(
    `UPDATE kb.documents SET status = 'processing', error = NULL, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status = 'failed'`,
    [tenantId, id],
  )
  if (rowCount) return 'ok'
  return (await getDocument(db, tenantId, id)) ? 'not_failed' : 'not_found'
}

/** Only a document still processing can fail; a deleted or finished one is left alone. */
export async function markFailed(db: Db, tenantId: string, id: string, message: string): Promise<void> {
  await db.query(
    `UPDATE kb.documents SET status = 'failed', error = $3, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status = 'processing'`,
    [tenantId, id, message],
  )
}

export async function getExtractedText(
  db: Db,
  tenantId: string,
  id: string,
): Promise<{ status: DocumentStatus; text: string | null } | null> {
  const { rows } = await db.query<{ status: DocumentStatus; extracted_text: string | null }>(
    'SELECT status, extracted_text FROM kb.documents WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  )
  return rows[0] ? { status: rows[0].status, text: rows[0].extracted_text } : null
}

/** At startup no job is running, so anything still `processing` was interrupted (spec §4.1). */
export async function sweepStuckDocuments(db: Db): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE kb.documents SET status = 'failed', error = 'Processing was interrupted. Retry to process it again.', updated_at = now()
     WHERE status = 'processing'`,
  )
  return rowCount ?? 0
}
