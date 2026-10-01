import type { Db } from '@helpix/shared'
import type { KbSearchResult } from '@helpix/shared/api-types'
import type { Chunk } from '../ingest/chunker'

export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`
}

/**
 * Atomically stores a document's chunks and marks it ready. Returns false, writing nothing, when the document was
 * deleted or is no longer processing. The UPDATE runs first and locks the row, so a concurrent delete waits for us.
 */
export async function replaceChunksAndMarkReady(
  db: Db,
  input: { tenantId: string; documentId: string; chunks: Chunk[]; vectors: number[][]; model: string; text: string },
): Promise<boolean> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const { rowCount } = await client.query(
      `UPDATE kb.documents SET status = 'ready', error = NULL, extracted_text = $3, embedding_model = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'processing'`,
      [input.tenantId, input.documentId, input.text, input.model],
    )
    if (!rowCount) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query('DELETE FROM kb.chunks WHERE tenant_id = $1 AND document_id = $2', [input.tenantId, input.documentId])
    await client.query(
      `INSERT INTO kb.chunks (tenant_id, document_id, position, text, embedding, embedding_model)
       SELECT $1, $2, u.position, u.text, u.embedding::vector, $3
       FROM unnest($4::int[], $5::text[], $6::text[]) AS u(position, text, embedding)`,
      [
        input.tenantId,
        input.documentId,
        input.model,
        input.chunks.map((c) => c.position),
        input.chunks.map((c) => c.text),
        input.vectors.map(toVectorLiteral),
      ],
    )
    await client.query('COMMIT')
    return true
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function searchChunks(
  db: Db,
  input: { tenantId: string; model: string; vector: number[]; limit: number },
): Promise<KbSearchResult[]> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    // pgvector ≥ 0.8: keep walking the HNSW graph until `limit` rows pass the tenant/model filter, instead of
    // filtering a fixed candidate list (which can return too few rows for a small tenant).
    await client.query('SET LOCAL hnsw.iterative_scan = strict_order')
    const { rows } = await client.query<{ document_id: string; title: string; position: number; text: string; score: number }>(
      `SELECT c.document_id, d.title, c.position, c.text, 1 - (c.embedding <=> $1::vector) AS score
       FROM kb.chunks c
       JOIN kb.documents d ON d.id = c.document_id AND d.tenant_id = c.tenant_id
       WHERE c.tenant_id = $2 AND c.embedding_model = $3 AND d.status = 'ready'
       ORDER BY c.embedding <=> $1::vector
       LIMIT $4`,
      [toVectorLiteral(input.vector), input.tenantId, input.model, input.limit],
    )
    await client.query('COMMIT')
    return rows.map((r) => ({ documentId: r.document_id, title: r.title, position: r.position, text: r.text, score: Number(r.score) }))
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function chunksNeedingReindex(db: Db, tenantId: string, model: string, limit: number): Promise<{ id: string; text: string }[]> {
  const { rows } = await db.query<{ id: string; text: string }>(
    'SELECT id, text FROM kb.chunks WHERE tenant_id = $1 AND embedding_model <> $2 ORDER BY id LIMIT $3',
    [tenantId, model, limit],
  )
  return rows
}

export async function updateChunkEmbeddings(
  db: Db,
  tenantId: string,
  model: string,
  items: { id: string; vector: number[] }[],
): Promise<void> {
  await db.query(
    `UPDATE kb.chunks c SET embedding = u.embedding::vector, embedding_model = $2
     FROM unnest($3::uuid[], $4::text[]) AS u(id, embedding)
     WHERE c.id = u.id AND c.tenant_id = $1`,
    [tenantId, model, items.map((i) => i.id), items.map((i) => toVectorLiteral(i.vector))],
  )
}

/** Records the model on ready documents whose chunks are all on it. */
export async function markDocumentsModel(db: Db, tenantId: string, model: string): Promise<void> {
  await db.query(
    `UPDATE kb.documents d SET embedding_model = $2, updated_at = now()
     WHERE d.tenant_id = $1 AND d.status = 'ready' AND d.embedding_model IS DISTINCT FROM $2
       AND NOT EXISTS (SELECT 1 FROM kb.chunks c WHERE c.document_id = d.id AND c.embedding_model <> $2)`,
    [tenantId, model],
  )
}

export async function countChunks(db: Db, tenantId: string, model: string): Promise<{ total: number; done: number }> {
  const { rows } = await db.query<{ total: number; done: number }>(
    `SELECT count(*)::int AS total, (count(*) FILTER (WHERE embedding_model = $2))::int AS done
     FROM kb.chunks WHERE tenant_id = $1`,
    [tenantId, model],
  )
  return rows[0]!
}
