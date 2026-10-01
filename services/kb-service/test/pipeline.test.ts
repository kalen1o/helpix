import { EmbeddingError, createFakeEmbeddings, type EmbeddingProvider } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KbDeps } from '../src/deps'
import { processDocument } from '../src/ingest/pipeline'
import { deleteDocument, getDocument } from '../src/repos/documents'
import { longText } from './fixtures'
import { makeDeps, resetDb, setupTestDb, tempDir, TENANT_A } from './helpers'
import { seedDocument, silentLog } from './seed'

let db: Db
let deps: KbDeps
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  deps = makeDeps(db, await tempDir())
})

const fake = createFakeEmbeddings({ model: 'hash', dimensions: 1024 })
const chunkRows = (id: string) =>
  db.query<{ tenant_id: string; position: number; embedding_model: string }>(
    'SELECT tenant_id, position, embedding_model FROM kb.chunks WHERE document_id = $1 ORDER BY position',
    [id],
  )

describe('processDocument', () => {
  it('extracts, chunks and embeds a document, then marks it ready', async () => {
    const id = await seedDocument(deps, TENANT_A, { filename: 'policy.md', data: `# Returns\n\n${longText(1500)}` })
    await processDocument({ ...deps, log: silentLog }, TENANT_A, id)
    const doc = (await getDocument(db, TENANT_A, id))!
    expect(doc).toMatchObject({ status: 'ready', error: null, embedding_model: 'fake:hash:1024' })
    expect(doc.chunk_count).toBeGreaterThan(1)
    const { rows } = await chunkRows(id)
    expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i))
    expect(rows.every((r) => r.tenant_id === TENANT_A && r.embedding_model === 'fake:hash:1024')).toBe(true)
    const stored = await db.query('SELECT extracted_text FROM kb.documents WHERE id = $1', [id])
    expect(stored.rows[0].extracted_text).toMatch(/^# Returns/)
  })

  it('fails a file with no text, with a message', async () => {
    const id = await seedDocument(deps, TENANT_A, { filename: 'blank.txt', data: '  \n\n  ' })
    await processDocument({ ...deps, log: silentLog }, TENANT_A, id)
    expect((await getDocument(db, TENANT_A, id))!).toMatchObject({ status: 'failed', error: 'This file contains no text.', chunk_count: 0 })
  })

  it('fails with a retryable message when embeddings are unavailable, without logging an error', async () => {
    const down: EmbeddingProvider = { ...fake, embed: async () => { throw new EmbeddingError('HTTP 503', true) } }
    const log = { error: vi.fn() }
    const id = await seedDocument(deps, TENANT_A, { filename: 'a.txt', data: 'Refunds within 30 days.' })
    await processDocument({ ...deps, embeddings: down, log }, TENANT_A, id)
    expect((await getDocument(db, TENANT_A, id))!).toMatchObject({
      status: 'failed',
      error: 'The embedding service is unavailable. Try again later.',
      chunk_count: 0,
    })
    expect(log.error).not.toHaveBeenCalled()
  })

  it('fails with a distinct message when the embedding service rejects the document (non-retryable)', async () => {
    const rejecting: EmbeddingProvider = { ...fake, embed: async () => { throw new EmbeddingError('HTTP 400', false) } }
    const id = await seedDocument(deps, TENANT_A, { filename: 'a.txt', data: 'Refunds within 30 days.' })
    await processDocument({ ...deps, embeddings: rejecting, log: silentLog }, TENANT_A, id)
    expect((await getDocument(db, TENANT_A, id))!).toMatchObject({
      status: 'failed',
      error: 'The embedding service rejected this document. Retrying will not help; try splitting it into smaller files.',
    })
  })

  it('never throws and logs when marking the document failed also fails', async () => {
    const broken: EmbeddingProvider = { ...fake, embed: async () => { throw new EmbeddingError('HTTP 503', true) } }
    const log = { error: vi.fn() }
    const id = await seedDocument(deps, TENANT_A, { filename: 'a.txt', data: 'hello' })
    const failingUpdate = {
      query: (sql: string, params?: unknown[]) =>
        /UPDATE kb\.documents SET status = 'failed'/.test(sql) ? Promise.reject(new Error('db down')) : db.query(sql, params),
    } as unknown as Db
    await expect(processDocument({ ...deps, db: failingUpdate, embeddings: broken, log }, TENANT_A, id)).resolves.toBeUndefined()
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ documentId: id }), 'could not mark document failed')
  })

  it('never throws when the initial document lookup fails', async () => {
    const log = { error: vi.fn() }
    const failing = { query: () => Promise.reject(new Error('db down')) } as unknown as Db
    await expect(processDocument({ ...deps, db: failing, log }, TENANT_A, 'x')).resolves.toBeUndefined()
    expect(log.error).toHaveBeenCalled()
  })

  it('fails when the stored file is missing', async () => {
    const id = await seedDocument(deps, TENANT_A, { filename: 'a.txt', data: 'hello' })
    await deps.storage.delete(`${TENANT_A}/${id}`)
    await processDocument({ ...deps, log: silentLog }, TENANT_A, id)
    expect((await getDocument(db, TENANT_A, id))!.error).toMatch(/stored file is missing/)
  })

  it('logs and fails on an unexpected error', async () => {
    const broken: EmbeddingProvider = { ...fake, embed: async () => { throw new Error('bug') } }
    const log = { error: vi.fn() }
    const id = await seedDocument(deps, TENANT_A, { filename: 'a.txt', data: 'hello' })
    await processDocument({ ...deps, embeddings: broken, log }, TENANT_A, id)
    expect((await getDocument(db, TENANT_A, id))!).toMatchObject({ status: 'failed', error: 'Processing failed. Try again.' })
    expect(log.error).toHaveBeenCalledOnce()
  })

  it('exits quietly when the document is deleted mid-processing', async () => {
    const log = { error: vi.fn() }
    let id = ''
    const deleting: EmbeddingProvider = {
      ...fake,
      embed: async (texts) => {
        await deleteDocument(db, TENANT_A, id)
        return fake.embed(texts)
      },
    }
    id = await seedDocument(deps, TENANT_A, { filename: 'a.txt', data: 'Refunds within 30 days.' })
    await expect(processDocument({ ...deps, embeddings: deleting, log }, TENANT_A, id)).resolves.toBeUndefined()
    expect((await chunkRows(id)).rows).toHaveLength(0)
    expect(log.error).not.toHaveBeenCalled()
  })

  it('replaces chunks rather than duplicating them when a document is processed again', async () => {
    const id = await seedDocument(deps, TENANT_A, { filename: 'a.md', data: longText(1500) })
    await processDocument({ ...deps, log: silentLog }, TENANT_A, id)
    const first = (await getDocument(db, TENANT_A, id))!.chunk_count
    await db.query("UPDATE kb.documents SET status = 'processing' WHERE id = $1", [id])
    await processDocument({ ...deps, log: silentLog }, TENANT_A, id)
    expect((await getDocument(db, TENANT_A, id))!.chunk_count).toBe(first)
  })

  it('does nothing for a document that is not processing', async () => {
    const embed = vi.fn(fake.embed)
    const id = await seedDocument(deps, TENANT_A, { filename: 'a.txt', data: 'hello' })
    await db.query("UPDATE kb.documents SET status = 'ready' WHERE id = $1", [id])
    await processDocument({ ...deps, embeddings: { ...fake, embed }, log: silentLog }, TENANT_A, id)
    expect(embed).not.toHaveBeenCalled()
  })
})
