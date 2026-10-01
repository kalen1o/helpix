import { EmbeddingError, createFakeEmbeddings } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import type { KbSearchResult } from '@helpix/shared/api-types'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { KbDeps } from '../src/deps'
import { buildTestApp, internalHeaders, makeDeps, resetDb, serviceHeaders, setupTestDb, tempDir, tenantHeaders, TENANT_A } from './helpers'
import { seedReadyDocument } from './seed'

let db: Db
let deps: KbDeps
let app: FastifyInstance
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  deps = makeDeps(db, await tempDir())
  app = await buildTestApp(deps)
})
afterEach(async () => { await app.close() })

const search = (payload: object, headers = serviceHeaders(TENANT_A)) =>
  app.inject({ method: 'POST', url: '/kb/search', headers, payload })
const results = async (payload: object) => (await search(payload)).json().results as KbSearchResult[]

async function seedPolicies() {
  const returns = await seedReadyDocument(deps, TENANT_A, { filename: 'returns.md', title: 'Returns', data: 'Our refund window is 30 days from delivery.' })
  const shipping = await seedReadyDocument(deps, TENANT_A, { filename: 'shipping.md', title: 'Shipping', data: 'We ship phones in recyclable boxes within 2 days.' })
  return { returns, shipping }
}

describe('POST /kb/search', () => {
  it('returns the closest chunk first, with its source title, position and score', async () => {
    const { returns } = await seedPolicies()
    const [top] = await results({ query: 'refund window' })
    expect(top).toMatchObject({ documentId: returns, title: 'Returns', position: 0, text: 'Our refund window is 30 days from delivery.' })
    expect(top!.score).toBeGreaterThan(0.05)
    expect(top!.score).toBeLessThanOrEqual(1)
  })

  it('drops results below the similarity threshold', async () => {
    await seedPolicies()
    expect(await results({ query: 'zebra giraffe' })).toEqual([])
  })

  it('caps results at the limit (default 5)', async () => {
    for (let i = 0; i < 7; i++) await seedReadyDocument(deps, TENANT_A, { filename: `d${i}.txt`, data: `refund policy number ${i}` })
    expect(await results({ query: 'refund policy' })).toHaveLength(5)
    expect(await results({ query: 'refund policy', limit: 2 })).toHaveLength(2)
  })

  it('ignores chunks embedded with a different model', async () => {
    await seedPolicies()
    await db.query("UPDATE kb.chunks SET embedding_model = 'old-model'")
    expect(await results({ query: 'refund window' })).toEqual([])
  })

  it('ignores documents that are not ready', async () => {
    const { returns } = await seedPolicies()
    await db.query("UPDATE kb.documents SET status = 'processing' WHERE id = $1", [returns])
    expect((await results({ query: 'refund window' })).map((r) => r.documentId)).not.toContain(returns)
  })

  it('answers 503 when the embedding service is down', async () => {
    await app.close()
    const fake = createFakeEmbeddings({ model: 'hash', dimensions: 1024 })
    deps = makeDeps(db, await tempDir(), { embeddings: { ...fake, embed: async () => { throw new EmbeddingError('HTTP 503', true) } } })
    app = await buildTestApp(deps)
    const res = await search({ query: 'refund' })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe('embedding_unavailable')
  })

  it('accepts a tenant admin or an internal service, and refuses a caller with no tenant', async () => {
    await seedPolicies()
    expect((await search({ query: 'refund' }, tenantHeaders(TENANT_A))).statusCode).toBe(200)
    expect((await search({ query: 'refund' }, internalHeaders())).statusCode).toBe(403)
  })

  it('validates the query', async () => {
    expect((await search({ query: '' })).statusCode).toBe(400)
    expect((await search({ query: '   ' })).statusCode).toBe(400)
    expect((await search({ query: 'x', limit: 11 })).statusCode).toBe(400)
  })
})
