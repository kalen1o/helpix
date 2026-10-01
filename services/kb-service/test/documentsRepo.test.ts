import { randomUUID } from 'node:crypto'
import type { Db } from '@helpix/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteDocument,
  getDocument,
  insertDocument,
  listDocuments,
  markFailed,
  markProcessingForRetry,
  sweepStuckDocuments,
} from '../src/repos/documents'
import { resetDb, setupTestDb, TENANT_A, TENANT_B } from './helpers'

let db: Db
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => { await resetDb(db) })

const insert = (tenantId: string, maxDocuments = 10) =>
  insertDocument(db, { id: randomUUID(), tenantId, title: 'Doc', mimeType: 'text/plain', sizeBytes: 3, maxDocuments })

describe('documents repository', () => {
  it('inserts a processing document with a tenant-prefixed storage key', async () => {
    const row = await insert(TENANT_A)
    expect(row).toMatchObject({ tenant_id: TENANT_A, status: 'processing', chunk_count: 0, error: null })
    expect(row.storage_key).toBe(`${TENANT_A}/${row.id}`)
  })

  it('enforces the per-tenant cap, per tenant', async () => {
    await insert(TENANT_A, 2)
    await insert(TENANT_A, 2)
    await expect(insert(TENANT_A, 2)).rejects.toMatchObject({ status: 409, code: 'document_limit_reached' })
    await expect(insert(TENANT_B, 2)).resolves.toBeTruthy()
  })

  it('holds the cap under concurrent inserts', async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => insert(TENANT_A, 2)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
  })

  it('scopes reads and deletes by tenant', async () => {
    const row = await insert(TENANT_A)
    expect(await getDocument(db, TENANT_B, row.id)).toBeNull()
    expect(await listDocuments(db, TENANT_B)).toEqual([])
    expect(await deleteDocument(db, TENANT_B, row.id)).toBeNull()
    expect(await deleteDocument(db, TENANT_A, row.id)).toEqual({ storageKey: row.storage_key })
    expect(await getDocument(db, TENANT_A, row.id)).toBeNull()
  })

  it('retries only failed documents', async () => {
    const row = await insert(TENANT_A)
    expect(await markProcessingForRetry(db, TENANT_A, row.id)).toBe('not_failed')
    await markFailed(db, TENANT_A, row.id, 'boom')
    expect((await getDocument(db, TENANT_A, row.id))!).toMatchObject({ status: 'failed', error: 'boom' })
    expect(await markProcessingForRetry(db, TENANT_B, row.id)).toBe('not_found')
    expect(await markProcessingForRetry(db, TENANT_A, row.id)).toBe('ok')
    expect((await getDocument(db, TENANT_A, row.id))!).toMatchObject({ status: 'processing', error: null })
  })

  it('sweeps documents left processing by a crash', async () => {
    const stuck = await insert(TENANT_A)
    const failed = await insert(TENANT_A)
    await markFailed(db, TENANT_A, failed.id, 'earlier failure')
    expect(await sweepStuckDocuments(db)).toBe(1)
    expect((await getDocument(db, TENANT_A, stuck.id))!).toMatchObject({ status: 'failed', error: expect.stringMatching(/interrupted/) })
    expect((await getDocument(db, TENANT_A, failed.id))!.error).toBe('earlier failure')
  })
})
