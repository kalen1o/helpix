import { randomUUID } from 'node:crypto'
import { createFakeEmbeddings } from '@helpix/llm'
import { HEADERS, type Db } from '@helpix/shared'
import type { KbDocumentView, KbSearchResult } from '@helpix/shared/api-types'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { KbDeps } from '../src/deps'
import { buildTestApp, internalHeaders, makeDeps, resetDb, setupTestDb, tempDir, tenantHeaders, TENANT_A, TENANT_B, TEST_CONFIG } from './helpers'
import { multipart } from './multipart'
import { seedReadyDocument } from './seed'

let db: Db
let dir: string
let deps: KbDeps
let app: FastifyInstance
let aDoc: string
let bDoc: string
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  dir = await tempDir()
  // No similarity threshold: any leak would show up in results.
  deps = makeDeps(db, dir, { config: { ...TEST_CONFIG, storageDir: dir, minScore: -1 } })
  app = await buildTestApp(deps)
  aDoc = await seedReadyDocument(deps, TENANT_A, { filename: 'a.md', title: 'A policy', data: 'Zebra returns policy: zebras may be returned within 30 days.' })
  bDoc = await seedReadyDocument(deps, TENANT_B, { filename: 'b.md', title: 'B policy', data: 'Giraffe shipping policy: giraffes ship in 2 days.' })
})
afterEach(async () => {
  await deps.jobs.idle()
  await app.close()
})

const as = (tenantId: string) => tenantHeaders(tenantId)
const superAdmin = () => ({ ...internalHeaders(), [HEADERS.role]: 'super_admin', [HEADERS.adminId]: randomUUID() })

const tenantOnly = (tenantId: string) => ({ ...internalHeaders(), [HEADERS.tenantId]: tenantId })
const adminNoId = (tenantId: string) => ({ ...internalHeaders(), [HEADERS.role]: 'tenant_admin', [HEADERS.tenantId]: tenantId })
const upload = (filename = 'u.md') => multipart([{ name: 'file', filename, data: 'uploaded by someone' }])

async function aIsIntact() {
  const res = await app.inject({ method: 'GET', url: `/kb/documents/${aDoc}`, headers: as(TENANT_A) })
  expect(res.json()).toMatchObject({ id: aDoc, status: 'ready', chunkCount: 1 })
  expect(await deps.storage.get(`${TENANT_A}/${aDoc}`)).not.toBeNull()
}

describe('kb-service tenant isolation', () => {
  it("lists only the caller's documents", async () => {
    const res = await app.inject({ method: 'GET', url: '/kb/documents', headers: as(TENANT_B) })
    expect((res.json().documents as KbDocumentView[]).map((d) => d.id)).toEqual([bDoc])
  })

  it.each([
    ['GET', ''],
    ['GET', '/file'],
    ['GET', '/text'],
    ['POST', '/retry'],
    ['DELETE', ''],
  ] as const)("%s /kb/documents/:id%s on another tenant's document is 404 and changes nothing", async (method, suffix) => {
    const res = await app.inject({ method, url: `/kb/documents/${aDoc}${suffix}`, headers: as(TENANT_B) })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('document_not_found')
    await aIsIntact()
  })

  it("never returns another tenant's chunks from search, even with no threshold", async () => {
    const res = await app.inject({ method: 'POST', url: '/kb/search', headers: as(TENANT_B), payload: { query: 'zebra returns policy', limit: 10 } })
    const results = res.json().results as KbSearchResult[]
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.documentId === bDoc)).toBe(true)
  })

  it('ignores a tenant id in the body or query string', async () => {
    const search = await app.inject({
      method: 'POST',
      url: `/kb/search?tenantId=${TENANT_A}`,
      headers: as(TENANT_B),
      payload: { query: 'zebra', tenantId: TENANT_A },
    })
    const searchResults = search.json().results as KbSearchResult[]
    expect(searchResults.length).toBeGreaterThan(0)
    expect(searchResults.every((r) => r.documentId === bDoc)).toBe(true)

    const paste = await app.inject({
      method: 'POST',
      url: `/kb/documents/text?tenantId=${TENANT_A}`,
      headers: as(TENANT_B),
      payload: { title: 'Sneaky', text: 'hello' },
    })
    expect(paste.statusCode).toBe(202)
    const pastedId = (paste.json() as KbDocumentView).id
    expect(await deps.storage.get(`${TENANT_B}/${pastedId}`)).not.toBeNull()
    expect(await deps.storage.get(`${TENANT_A}/${pastedId}`)).toBeNull()
    await deps.jobs.idle()
    const bList = await app.inject({ method: 'GET', url: '/kb/documents', headers: as(TENANT_B) })
    expect((bList.json().documents as KbDocumentView[]).some((d) => d.title === 'Sneaky')).toBe(true)
    const aList = await app.inject({ method: 'GET', url: '/kb/documents', headers: as(TENANT_A) })
    expect((aList.json().documents as KbDocumentView[]).map((d) => d.id)).toEqual([aDoc])
  })

  it("re-indexing one tenant leaves the other's chunks alone", async () => {
    const other = makeDeps(db, dir, { embeddings: createFakeEmbeddings({ model: 'b', dimensions: 1024 }) })
    const otherApp = await buildTestApp(other)
    await otherApp.inject({ method: 'POST', url: '/kb/reindex', headers: as(TENANT_B) })
    await other.reindex.idle()
    await otherApp.close()
    const { rows } = await db.query('SELECT tenant_id, embedding_model FROM kb.chunks ORDER BY tenant_id')
    expect(rows).toEqual([
      { tenant_id: TENANT_A, embedding_model: 'fake:hash:1024' },
      { tenant_id: TENANT_B, embedding_model: 'fake:b:1024' },
    ])
  })

  const ROUTES = [
    ['GET', '/kb/documents', undefined],
    ['POST', '/kb/documents/text', { title: 't', text: 'x' }],
    ['GET', '/kb/documents/:id', undefined],
    ['GET', '/kb/documents/:id/file', undefined],
    ['GET', '/kb/documents/:id/text', undefined],
    ['DELETE', '/kb/documents/:id', undefined],
    ['POST', '/kb/documents/:id/retry', undefined],
    ['POST', '/kb/search', { query: 'zebra' }],
    ['POST', '/kb/reindex', undefined],
    ['GET', '/kb/reindex', undefined],
  ] as const

  it.each(ROUTES)('%s %s refuses a caller with no tenant (internal-only or super-admin)', async (method, path, payload) => {
    const url = path.replace(':id', aDoc)
    for (const headers of [internalHeaders(), superAdmin()]) {
      const res = await app.inject({ method, url, headers, ...(payload ? { payload } : {}) })
      expect(res.statusCode).toBe(403)
    }
    await aIsIntact()
  })

  it.each(ROUTES)('%s %s refuses a request without the internal token', async (method, path, payload) => {
    const { [HEADERS.internalToken]: _dropped, ...headers } = as(TENANT_A)
    const res = await app.inject({ method, url: path.replace(':id', aDoc), headers, ...(payload ? { payload } : {}) })
    expect(res.statusCode).toBe(401)
  })

  it('stores each file under its own tenant prefix', async () => {
    expect(await deps.storage.get(`${TENANT_B}/${aDoc}`)).toBeNull()
    expect(await deps.storage.get(`${TENANT_A}/${aDoc}`)).not.toBeNull()
  })

  it('stores a multipart upload by tenant B under the B prefix only', async () => {
    const body = upload()
    const res = await app.inject({ method: 'POST', url: '/kb/documents', headers: { ...as(TENANT_B), ...body.headers }, payload: body.payload })
    expect(res.statusCode).toBe(202)
    const id = (res.json() as KbDocumentView).id
    expect(await deps.storage.get(`${TENANT_B}/${id}`)).not.toBeNull()
    expect(await deps.storage.get(`${TENANT_A}/${id}`)).toBeNull()
    await deps.jobs.idle()
  })

  it('POST /kb/documents (upload) refuses no-tenant callers (403) and a missing token (401)', async () => {
    const body = upload()
    for (const headers of [internalHeaders(), superAdmin()]) {
      const res = await app.inject({ method: 'POST', url: '/kb/documents', headers: { ...headers, ...body.headers }, payload: body.payload })
      expect(res.statusCode).toBe(403)
    }
    const { [HEADERS.internalToken]: _dropped, ...noToken } = as(TENANT_A)
    const res = await app.inject({ method: 'POST', url: '/kb/documents', headers: { ...noToken, ...body.headers }, payload: body.payload })
    expect(res.statusCode).toBe(401)
    const wrong = await app.inject({ method: 'POST', url: '/kb/documents', headers: { ...as(TENANT_A), [HEADERS.internalToken]: 'wrong-token', ...body.headers }, payload: body.payload })
    expect(wrong.statusCode).toBe(401)
    await aIsIntact()
  })

  it.each(ROUTES)('%s %s refuses a wrong internal token', async (method, path, payload) => {
    const headers = { ...as(TENANT_A), [HEADERS.internalToken]: 'wrong-token' }
    const res = await app.inject({ method, url: path.replace(':id', aDoc), headers, ...(payload ? { payload } : {}) })
    expect(res.statusCode).toBe(401)
  })

  it.each(ROUTES)('%s %s refuses tenant-only and admin-without-id callers, except search for tenant-only', async (method, path, payload) => {
    const url = path.replace(':id', aDoc)
    const searchPath = method === 'POST' && path === '/kb/search'
    const tenantOnlyRes = await app.inject({ method, url, headers: tenantOnly(TENANT_A), ...(payload ? { payload } : {}) })
    expect(tenantOnlyRes.statusCode).toBe(searchPath ? 200 : 403)
    const noIdRes = await app.inject({ method, url, headers: adminNoId(TENANT_A), ...(payload ? { payload } : {}) })
    expect(noIdRes.statusCode).toBe(searchPath ? 200 : 403)
    await aIsIntact()
  })

  it("GET /kb/reindex reports only the caller's chunks", async () => {
    const res = await app.inject({ method: 'GET', url: '/kb/reindex', headers: as(TENANT_B) })
    expect(res.json()).toMatchObject({ total: 1 })
  })
})
