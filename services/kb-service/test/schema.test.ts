import type { Db } from '@helpix/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetDb, setupTestDb, TENANT_A, TENANT_B } from './helpers'

let db: Db
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => { await resetDb(db) })

const DOC = '22222222-2222-4222-8222-222222222222'
const vector = (n = 1024) => `[${Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`

async function insertDoc() {
  await db.query(
    `INSERT INTO kb.documents (id, tenant_id, title, storage_key, mime_type, size_bytes) VALUES ($1, $2, 'T', 'k', 'text/plain', 1)`,
    [DOC, TENANT_A],
  )
}

describe('kb schema', () => {
  it("refuses a chunk whose tenant differs from its document's tenant", async () => {
    await insertDoc()
    await expect(
      db.query(
        `INSERT INTO kb.chunks (tenant_id, document_id, position, text, embedding, embedding_model) VALUES ($1, $2, 0, 't', $3::vector, 'm')`,
        [TENANT_B, DOC, vector()],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('refuses a vector of the wrong dimension', async () => {
    await insertDoc()
    await expect(
      db.query(
        `INSERT INTO kb.chunks (tenant_id, document_id, position, text, embedding, embedding_model) VALUES ($1, $2, 0, 't', $3::vector, 'm')`,
        [TENANT_A, DOC, vector(3)],
      ),
    ).rejects.toThrow(/expected 1024 dimensions/)
  })

  it('deletes chunks with their document', async () => {
    await insertDoc()
    await db.query(
      `INSERT INTO kb.chunks (tenant_id, document_id, position, text, embedding, embedding_model) VALUES ($1, $2, 0, 't', $3::vector, 'm')`,
      [TENANT_A, DOC, vector()],
    )
    await db.query('DELETE FROM kb.documents WHERE id = $1', [DOC])
    expect((await db.query('SELECT count(*)::int AS n FROM kb.chunks')).rows[0].n).toBe(0)
  })
})
