import { randomUUID } from 'node:crypto'
import multipart, { type MultipartFile } from '@fastify/multipart'
import type { FastifyPluginAsync } from 'fastify'
import { AppError } from '@helpix/shared'
import type { KbDocumentText, KbDocumentView } from '@helpix/shared/api-types'
import type { KbDeps } from '../deps'
import { detectKind, isTextExtension, KIND_INFO, kindFromMime, type KbFileKind } from '../ingest/extract'
import { processDocument } from '../ingest/pipeline'
import { adminTenant } from '../lib/context'
import { cleanTitle, contentDisposition, titleFromFilename } from '../lib/names'
import {
  deleteDocument,
  documentNotFound,
  getDocument,
  getExtractedText,
  insertDocument,
  listDocuments,
  markProcessingForRetry,
  toDocumentView,
} from '../repos/documents'

const MAX_PASTED_TEXT_CHARS = 200_000

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const

const pasteBody = {
  type: 'object',
  required: ['title', 'text'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
    text: { type: 'string', minLength: 1, maxLength: MAX_PASTED_TEXT_CHARS },
  },
} as const

type IdRequest = { Params: { id: string } }

function fieldValue(part: MultipartFile, name: string): string {
  const field = part.fields[name]
  const one = Array.isArray(field) ? field[0] : field
  return one && one.type === 'field' && typeof one.value === 'string' ? one.value : ''
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.round(bytes / 1024)} KB`
}

export const documentRoutes: FastifyPluginAsync<KbDeps> = async (app, deps) => {
  const { db, config, storage, jobs } = deps
  await app.register(multipart, {
    throwFileSizeLimit: true,
    limits: { fileSize: config.maxFileBytes, files: 1, fields: 2, fieldSize: 1000, parts: 3 },
  })

  const enqueue = (tenantId: string, id: string) => jobs.run(() => processDocument({ ...deps, log: app.log }, tenantId, id))

  async function create(tenantId: string, title: string, kind: KbFileKind, data: Buffer): Promise<KbDocumentView> {
    const id = randomUUID()
    const row = await insertDocument(db, {
      id,
      tenantId,
      title,
      mimeType: KIND_INFO[kind].mimeType,
      sizeBytes: data.length,
      maxDocuments: config.maxDocumentsPerTenant,
    })
    try {
      await storage.put(row.storage_key, data)
    } catch (e) {
      await deleteDocument(db, tenantId, id)
      throw e
    }
    enqueue(tenantId, id)
    return toDocumentView(row)
  }

  async function mustGet(tenantId: string, id: string) {
    const doc = await getDocument(db, tenantId, id)
    if (!doc) throw documentNotFound()
    return doc
  }

  app.post('/kb/documents', async (req, reply) => {
    const tenantId = adminTenant(req)
    if (!req.isMultipart()) throw new AppError(415, 'multipart_required', 'Upload the file as multipart/form-data')
    const part = await req.file()
    if (!part) throw new AppError(400, 'file_required', 'No file was uploaded')
    let data: Buffer
    try {
      data = await part.toBuffer()
    } catch (e) {
      if (e instanceof app.multipartErrors.RequestFileTooLargeError) {
        throw new AppError(413, 'file_too_large', `Files must be ${formatSize(config.maxFileBytes)} or smaller`)
      }
      throw e
    }
    if (data.length === 0) throw new AppError(400, 'empty_file', 'The file is empty')
    const kind = detectKind(part.filename, data)
    if (!kind) {
      throw new AppError(
        415,
        'unsupported_file_type',
        isTextExtension(part.filename) ? 'Text files must be UTF-8 encoded.' : 'Upload a PDF, DOCX, Markdown or TXT file',
      )
    }
    const title = cleanTitle(fieldValue(part, 'title')) || titleFromFilename(part.filename)
    return reply.code(202).send(await create(tenantId, title, kind, data))
  })

  app.post<{ Body: { title: string; text: string } }>(
    '/kb/documents/text',
    { schema: { body: pasteBody }, bodyLimit: 2 * 1024 * 1024 },
    async (req, reply) => {
      const tenantId = adminTenant(req)
      if (!req.body.text.trim()) throw new AppError(400, 'empty_text', 'Paste some text first')
      const title = cleanTitle(req.body.title) || 'Untitled'
      return reply.code(202).send(await create(tenantId, title, 'text', Buffer.from(req.body.text, 'utf8')))
    },
  )

  app.get('/kb/documents', async (req): Promise<{ documents: KbDocumentView[] }> => {
    const rows = await listDocuments(db, adminTenant(req))
    return { documents: rows.map(toDocumentView) }
  })

  app.get<IdRequest>('/kb/documents/:id', { schema: { params: idParams } }, async (req): Promise<KbDocumentView> => {
    return toDocumentView(await mustGet(adminTenant(req), req.params.id))
  })

  app.get<IdRequest>('/kb/documents/:id/file', { schema: { params: idParams } }, async (req, reply) => {
    const doc = await mustGet(adminTenant(req), req.params.id)
    const data = await storage.get(doc.storage_key)
    if (!data) throw new AppError(404, 'file_missing', 'The stored file is missing')
    const kind = kindFromMime(doc.mime_type) ?? 'text'
    const binary = kind === 'pdf' || kind === 'docx'
    return reply
      .header('content-type', binary ? doc.mime_type : `${doc.mime_type}; charset=utf-8`)
      .header('content-disposition', contentDisposition(doc.title + KIND_INFO[kind].extension))
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store')
      .send(data)
  })

  app.get<IdRequest>('/kb/documents/:id/text', { schema: { params: idParams } }, async (req): Promise<KbDocumentText> => {
    const found = await getExtractedText(db, adminTenant(req), req.params.id)
    if (!found) throw documentNotFound()
    if (found.status !== 'ready') throw new AppError(409, 'document_not_ready', 'The text is available once the document is ready')
    return { text: found.text ?? '' }
  })

  app.delete<IdRequest>('/kb/documents/:id', { schema: { params: idParams } }, async (req, reply) => {
    const deleted = await deleteDocument(db, adminTenant(req), req.params.id)
    if (!deleted) throw documentNotFound()
    try {
      await storage.delete(deleted.storageKey)
    } catch (err) {
      // The row is gone, so the document is deleted for the admin; an orphaned file is only a disk-space issue.
      req.log.error({ err, storageKey: deleted.storageKey }, 'could not delete stored file')
    }
    return reply.code(204).send()
  })

  app.post<IdRequest>('/kb/documents/:id/retry', { schema: { params: idParams } }, async (req, reply) => {
    const tenantId = adminTenant(req)
    const result = await markProcessingForRetry(db, tenantId, req.params.id)
    if (result === 'not_found') throw documentNotFound()
    if (result === 'not_failed') throw new AppError(409, 'document_not_failed', 'Only failed documents can be retried')
    // Build the response before enqueueing so it always shows `processing`.
    const view = toDocumentView(await mustGet(tenantId, req.params.id))
    enqueue(tenantId, req.params.id)
    return reply.code(202).send(view)
  })
}
