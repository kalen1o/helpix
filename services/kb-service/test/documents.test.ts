import { EmbeddingError, createFakeEmbeddings } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import type { KbDocumentView } from '@helpix/shared/api-types'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { KbDeps } from '../src/deps'
import { makeDocx, makePdf } from './fixtures'
import { buildTestApp, internalHeaders, makeDeps, resetDb, setupTestDb, tempDir, tenantHeaders, TENANT_A } from './helpers'
import { multipart } from './multipart'
import { seedDocument } from './seed'

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
afterEach(async () => {
  await deps.jobs.idle()
  await app.close()
})

const A = () => tenantHeaders(TENANT_A)

function upload(filename: string, data: Buffer | string, title?: string) {
  const body = multipart([...(title !== undefined ? [{ name: 'title', data: title }] : []), { name: 'file', filename, data }])
  return app.inject({ method: 'POST', url: '/kb/documents', headers: { ...A(), ...body.headers }, payload: body.payload })
}

const get = (url: string) => app.inject({ method: 'GET', url, headers: A() })
const list = async () => (await get('/kb/documents')).json().documents as KbDocumentView[]

describe('POST /kb/documents (file upload)', () => {
  it('accepts a Markdown file, returns 202 processing, then becomes ready', async () => {
    const res = await upload('Returns.md', '# Returns\n\nRefunds within 30 days.')
    expect(res.statusCode).toBe(202)
    const doc = res.json() as KbDocumentView
    expect(doc).toMatchObject({ title: 'Returns', mimeType: 'text/markdown', status: 'processing', sizeBytes: 34 })
    await deps.jobs.idle()
    expect((await get(`/kb/documents/${doc.id}`)).json()).toMatchObject({ status: 'ready', error: null, chunkCount: 1 })
  })

  it('accepts PDF and DOCX files', async () => {
    expect((await upload('policy.pdf', await makePdf(['Refunds within 30 days']))).json().mimeType).toBe('application/pdf')
    expect((await upload('faq.docx', await makeDocx(['Ships in 2 days']))).statusCode).toBe(202)
    await deps.jobs.idle()
    expect((await list()).map((d) => d.status)).toEqual(['ready', 'ready'])
  })

  it('uses the title field when given', async () => {
    expect((await upload('x.txt', 'hello', '  Shipping   FAQ ')).json().title).toBe('Shipping FAQ')
  })

  it('derives the title from a hostile path without affecting storage', async () => {
    const doc = (await upload('../../etc/Return Policy.md', 'hello')).json() as KbDocumentView
    expect(doc.title).toBe('Return Policy')
    expect(await deps.storage.get(`${TENANT_A}/${doc.id}`)).not.toBeNull()
  })

  it('keeps a UTF-8 file name and serves it back with a valid content-disposition', async () => {
    // Browsers send the raw UTF-8 bytes in the filename parameter (quotes are covered by names.test.ts).
    const doc = (await upload('báo giá mới.txt', 'Giá: 100k')).json() as KbDocumentView
    expect(doc.title).toBe('báo giá mới')
    const file = await get(`/kb/documents/${doc.id}/file`)
    expect(file.headers['content-disposition']).toBe(
      `attachment; filename="bao gia moi.txt"; filename*=UTF-8''b%C3%A1o%20gi%C3%A1%20m%E1%BB%9Bi.txt`,
    )
  })

  it('refuses files whose type is unsupported or does not match their bytes', async () => {
    for (const [name, data] of [
      ['setup.exe', 'MZ'],
      ['fake.pdf', 'plain text'],
      ['bad.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9])],
    ] as const) {
      const res = await upload(name, data)
      expect(res.statusCode).toBe(415)
      expect(res.json().error.code).toBe('unsupported_file_type')
    }
    expect(await list()).toEqual([])
  })

  it('says text files must be UTF-8 when a .txt is not valid UTF-8', async () => {
    const res = await upload('bad.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    expect(res.statusCode).toBe(415)
    expect(res.json().error).toMatchObject({ code: 'unsupported_file_type', message: 'Text files must be UTF-8 encoded.' })
  })

  it('refuses an empty file', async () => {
    const res = await upload('empty.txt', '')
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('empty_file')
  })

  it('refuses a file over the size cap without creating a document', async () => {
    const res = await upload('big.txt', 'x'.repeat(deps.config.maxFileBytes + 1))
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('file_too_large')
    expect(await list()).toEqual([])
  })

  it('refuses a request with no file part, or a non-multipart body', async () => {
    const body = multipart([{ name: 'title', data: 'x' }])
    const noFile = await app.inject({ method: 'POST', url: '/kb/documents', headers: { ...A(), ...body.headers }, payload: body.payload })
    expect(noFile.json().error.code).toBe('file_required')
    const json = await app.inject({ method: 'POST', url: '/kb/documents', headers: A(), payload: { title: 'x' } })
    expect(json.statusCode).toBe(415)
    expect(json.json().error.code).toBe('multipart_required')
  })

  it('enforces the per-tenant document cap', async () => {
    for (let i = 0; i < deps.config.maxDocumentsPerTenant; i++) expect((await upload(`d${i}.txt`, 'hi')).statusCode).toBe(202)
    const res = await upload('one-more.txt', 'hi')
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('document_limit_reached')
  })
})

describe('POST /kb/documents/text (pasted text)', () => {
  const paste = (payload: unknown) => app.inject({ method: 'POST', url: '/kb/documents/text', headers: A(), payload: payload as object })

  it('stores pasted text as a text/plain document', async () => {
    const res = await paste({ title: 'Opening hours', text: 'Mon–Fri 9–5' })
    expect(res.statusCode).toBe(202)
    const doc = res.json() as KbDocumentView
    expect(doc).toMatchObject({ title: 'Opening hours', mimeType: 'text/plain' })
    await deps.jobs.idle()
    const file = await get(`/kb/documents/${doc.id}/file`)
    expect(file.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(file.body).toBe('Mon–Fri 9–5')
  })

  it('refuses blank text and a missing title', async () => {
    expect((await paste({ title: 'x', text: '   ' })).json().error.code).toBe('empty_text')
    expect((await paste({ text: 'hello' })).json().error.code).toBe('validation_error')
  })
})

describe('reading, deleting and retrying documents', () => {
  it('lists newest first', async () => {
    await upload('first.txt', 'a')
    await upload('second.txt', 'b')
    expect((await list()).map((d) => d.title)).toEqual(['second', 'first'])
  })

  it('serves the original file with safe headers', async () => {
    const pdf = await makePdf(['Hello'])
    const doc = (await upload('p.pdf', pdf)).json() as KbDocumentView
    const res = await get(`/kb/documents/${doc.id}/file`)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.rawPayload.equals(pdf)).toBe(true)
  })

  it('returns extracted text once ready, and 409 before', async () => {
    const pending = await seedDocument(deps, TENANT_A, { filename: 'p.txt', data: 'pending' })
    expect((await get(`/kb/documents/${pending}/text`)).json().error.code).toBe('document_not_ready')
    const doc = (await upload('faq.docx', await makeDocx(['Ships in 2 days']))).json() as KbDocumentView
    await deps.jobs.idle()
    expect((await get(`/kb/documents/${doc.id}/text`)).json().text).toContain('Ships in 2 days')
  })

  it('deletes the row, its chunks and its file', async () => {
    const doc = (await upload('a.txt', 'hello world')).json() as KbDocumentView
    await deps.jobs.idle()
    const del = await app.inject({ method: 'DELETE', url: `/kb/documents/${doc.id}`, headers: A() })
    expect(del.statusCode).toBe(204)
    expect(await deps.storage.get(`${TENANT_A}/${doc.id}`)).toBeNull()
    expect((await db.query('SELECT count(*)::int AS n FROM kb.chunks')).rows[0].n).toBe(0)
    expect((await app.inject({ method: 'DELETE', url: `/kb/documents/${doc.id}`, headers: A() })).statusCode).toBe(404)
  })

  it('retries a failed document until it is ready', async () => {
    let down = true
    const fake = createFakeEmbeddings({ model: 'hash', dimensions: 1024 })
    const flaky = { ...fake, embed: async (t: string[]) => { if (down) throw new EmbeddingError('HTTP 503', true); return fake.embed(t) } }
    await app.close()
    deps = makeDeps(db, await tempDir(), { embeddings: flaky })
    app = await buildTestApp(deps)

    const doc = (await upload('a.txt', 'hello')).json() as KbDocumentView
    await deps.jobs.idle()
    expect((await get(`/kb/documents/${doc.id}`)).json()).toMatchObject({ status: 'failed', error: expect.stringMatching(/embedding service/) })

    down = false
    const retry = await app.inject({ method: 'POST', url: `/kb/documents/${doc.id}/retry`, headers: A() })
    expect(retry.statusCode).toBe(202)
    expect(retry.json().status).toBe('processing')
    await deps.jobs.idle()
    expect((await get(`/kb/documents/${doc.id}`)).json().status).toBe('ready')

    const again = await app.inject({ method: 'POST', url: `/kb/documents/${doc.id}/retry`, headers: A() })
    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('document_not_failed')
  })

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const unknown = await get('/kb/documents/33333333-3333-4333-8333-333333333333')
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json().error.code).toBe('document_not_found')
    expect((await get('/kb/documents/not-a-uuid')).statusCode).toBe(400)
  })

  it('requires a tenant admin', async () => {
    expect((await app.inject({ method: 'GET', url: '/kb/documents', headers: internalHeaders() })).statusCode).toBe(403)
  })
})
