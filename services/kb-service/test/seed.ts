import { randomUUID } from 'node:crypto'
import type { KbDeps } from '../src/deps'
import { detectKind, KIND_INFO } from '../src/ingest/extract'
import { processDocument } from '../src/ingest/pipeline'
import { insertDocument } from '../src/repos/documents'

export const silentLog = { error: () => {} }

/** Inserts a document row and stores its file, as the upload route does, without processing it. */
export async function seedDocument(
  deps: KbDeps,
  tenantId: string,
  input: { filename: string; data: Buffer | string; title?: string },
): Promise<string> {
  const data = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data)
  const kind = detectKind(input.filename, data)
  if (!kind) throw new Error(`Fixture ${input.filename} is not a supported file`)
  const id = randomUUID()
  const row = await insertDocument(deps.db, {
    id,
    tenantId,
    title: input.title ?? input.filename,
    mimeType: KIND_INFO[kind].mimeType,
    sizeBytes: data.length,
    maxDocuments: 1000,
  })
  await deps.storage.put(row.storage_key, data)
  return id
}

export async function seedReadyDocument(
  deps: KbDeps,
  tenantId: string,
  input: { filename: string; data: Buffer | string; title?: string },
): Promise<string> {
  const id = await seedDocument(deps, tenantId, input)
  await processDocument({ ...deps, log: silentLog }, tenantId, id)
  return id
}
