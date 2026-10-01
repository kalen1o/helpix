import { EmbeddingError, type EmbeddingProvider } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import { replaceChunksAndMarkReady } from '../repos/chunks'
import { getDocument, markFailed } from '../repos/documents'
import type { FileStorage } from '../storage'
import { chunkText } from './chunker'
import { ExtractionError, extractText, kindFromMime } from './extract'

export const MAX_CHUNKS_PER_DOCUMENT = 2000

export interface Logger {
  error(obj: object, msg: string): void
}

export interface IngestDeps {
  db: Db
  storage: FileStorage
  embeddings: EmbeddingProvider
  log: Logger
}

function failureMessage(err: unknown): string {
  if (err instanceof ExtractionError) return err.message
  if (err instanceof EmbeddingError) {
    return err.retryable === false
      ? 'The embedding service rejected this document. Retrying will not help; try splitting it into smaller files.'
      : 'The embedding service is unavailable. Try again later.'
  }
  return 'Processing failed. Try again.'
}

/**
 * Extract → chunk → embed → store, for one `processing` document. Never throws: failures mark the document
 * failed, and if even that DB write fails the error is logged (the document is then left for a retry/reindex).
 */
export async function processDocument(deps: IngestDeps, tenantId: string, documentId: string): Promise<void> {
  try {
    const doc = await getDocument(deps.db, tenantId, documentId)
    if (!doc || doc.status !== 'processing') return
    const data = await deps.storage.get(doc.storage_key)
    if (!data) throw new ExtractionError('The stored file is missing. Delete this document and upload it again.')
    const kind = kindFromMime(doc.mime_type)
    if (!kind) throw new ExtractionError('This file type is not supported.')
    const text = await extractText(kind, data)
    const chunks = chunkText(text)
    if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
      throw new ExtractionError(`This document is too long (over ${MAX_CHUNKS_PER_DOCUMENT} chunks). Split it into smaller files.`)
    }
    const vectors = await deps.embeddings.embed(chunks.map((c) => c.text))
    // false means the document was deleted meanwhile: nothing to do.
    await replaceChunksAndMarkReady(deps.db, { tenantId, documentId, chunks, vectors, model: deps.embeddings.modelId, text })
  } catch (err) {
    if (!(err instanceof ExtractionError) && !(err instanceof EmbeddingError)) {
      deps.log.error({ err, documentId }, 'document processing failed')
    }
    try {
      await markFailed(deps.db, tenantId, documentId, failureMessage(err))
    } catch (markErr) {
      deps.log.error({ err: markErr, documentId }, 'could not mark document failed')
    }
  }
}
