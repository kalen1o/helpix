import { EmbeddingError, createFakeEmbeddings, type EmbeddingProvider } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KbDeps } from '../src/deps'
import { reindexStatus, reindexTenant } from '../src/reindex'
import { buildTestApp, makeDeps, resetDb, setupTestDb, tempDir, tenantHeaders, TENANT_A } from './helpers'
import { seedReadyDocument } from './seed'

let db: Db
let dir: string
let oldDeps: KbDeps
let app: FastifyInstance | undefined
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  dir = await tempDir()
  oldDeps = makeDeps(db, dir)
  await seedReadyDocument(oldDeps, TENANT_A, { filename: 'a.txt', data: 'Our refund window is 30 days.' })
  await seedReadyDocument(oldDeps, TENANT_A, { filename: 'b.txt', data: 'We ship in 2 days.' })
  await seedReadyDocument(oldDeps, TENANT_A, { filename: 'c.txt', data: 'Phones come with a charger.' })
})
afterEach(async () => { await app?.close(); app = undefined })

const modelB = createFakeEmbeddings({ model: 'b', dimensions: 1024 })
const withModel = (embeddings: EmbeddingProvider) => makeDeps(db, dir, { embeddings })

describe('re-indexing', () => {
  it('reports progress against the current model', async () => {
    const deps = withModel(modelB)
    expect(await reindexStatus(deps, TENANT_A)).toEqual({ running: false, total: 3, done: 0, model: 'fake:b:1024' })
    expect(await reindexStatus(oldDeps, TENANT_A)).toMatchObject({ total: 3, done: 3 })
  })

  it('re-embeds every chunk and updates the documents, via the API', async () => {
    const deps = withModel(modelB)
    app = await buildTestApp(deps)
    const start = await app.inject({ method: 'POST', url: '/kb/reindex', headers: tenantHeaders(TENANT_A) })
    expect(start.statusCode).toBe(202)
    await deps.reindex.idle()
    const status = await app.inject({ method: 'GET', url: '/kb/reindex', headers: tenantHeaders(TENANT_A) })
    expect(status.json()).toEqual({ running: false, total: 3, done: 3, model: 'fake:b:1024' })
    const docs = await db.query('SELECT DISTINCT embedding_model FROM kb.documents')
    expect(docs.rows).toEqual([{ embedding_model: 'fake:b:1024' }])
    const search = await app.inject({ method: 'POST', url: '/kb/search', headers: tenantHeaders(TENANT_A), payload: { query: 'refund window' } })
    expect(search.json().results.length).toBeGreaterThan(0)
  })

  it('stops on an embedding failure with accurate progress, and resumes on the next run', async () => {
    let calls = 0
    const failing: EmbeddingProvider = {
      ...modelB,
      embed: async (t) => {
        if (++calls === 2) throw new EmbeddingError('HTTP 503', true)
        return modelB.embed(t)
      },
    }
    await expect(reindexTenant(withModel(failing), TENANT_A, 1)).rejects.toBeInstanceOf(EmbeddingError)
    expect(await reindexStatus(withModel(modelB), TENANT_A)).toMatchObject({ total: 3, done: 1 })
    await reindexTenant(withModel(modelB), TENANT_A, 1)
    expect(await reindexStatus(withModel(modelB), TENANT_A)).toMatchObject({ total: 3, done: 3 })
  })

  it('runs at most one re-index per tenant at a time', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const embed = vi.fn(async (t: string[]) => { await gate; return modelB.embed(t) })
    const deps = withModel({ ...modelB, embed })
    app = await buildTestApp(deps)
    const first = await app.inject({ method: 'POST', url: '/kb/reindex', headers: tenantHeaders(TENANT_A) })
    expect(first.json().running).toBe(true)
    await app.inject({ method: 'POST', url: '/kb/reindex', headers: tenantHeaders(TENANT_A) })
    release()
    await deps.reindex.idle()
    expect(embed).toHaveBeenCalledTimes(1) // 3 chunks fit in one batch of 64
  })

  it('does nothing when every chunk already uses the current model', async () => {
    const embed = vi.fn(oldDeps.embeddings.embed)
    await reindexTenant({ ...oldDeps, embeddings: { ...oldDeps.embeddings, embed } }, TENANT_A)
    expect(embed).not.toHaveBeenCalled()
  })
})
