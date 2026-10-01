import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeEmbeddings } from '@helpix/llm'
import { createPool, HEADERS, migrate, type Db } from '@helpix/shared'
import { TEST_DATABASE_URL } from '@helpix/shared/testing'
import { buildApp } from '../src/app'
import type { KbConfig } from '../src/config'
import type { KbDeps } from '../src/deps'
import { createJobRunner } from '../src/jobs'
import { createReindexTracker } from '../src/reindex'
import { createLocalStorage } from '../src/storage'

export const TENANT_A = '00000000-0000-4000-8000-00000000000a'
export const TENANT_B = '00000000-0000-4000-8000-00000000000b'

export const TEST_CONFIG: KbConfig = {
  port: 0,
  databaseUrl: TEST_DATABASE_URL,
  internalToken: 'kb-service-test-internal-token-0123456789',
  storageDir: '',
  maxFileBytes: 64 * 1024,
  maxDocumentsPerTenant: 5,
  searchTopK: 5,
  minScore: 0.05,
  jobConcurrency: 1,
  embedding: {
    provider: 'fake',
    baseUrl: '',
    apiKey: '',
    model: 'hash',
    dimensions: 1024,
    batchMaxItems: 64,
    batchMaxTokens: 3000,
    timeoutMs: 1000,
  },
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url))

export async function setupTestDb(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL)
  await migrate(db, { schema: 'kb', dir: MIGRATIONS_DIR })
  return db
}

export async function resetDb(db: Db): Promise<void> {
  await db.query('TRUNCATE kb.chunks, kb.documents')
}

export function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'helpix-kb-'))
}

export function makeDeps(db: Db, storageDir: string, overrides: Partial<KbDeps> = {}): KbDeps {
  return {
    db,
    config: { ...TEST_CONFIG, storageDir },
    storage: createLocalStorage(storageDir),
    embeddings: createFakeEmbeddings({ model: 'hash', dimensions: 1024 }),
    jobs: createJobRunner({ concurrency: 1, onError: (err) => console.error(err) }),
    reindex: createReindexTracker((err) => console.error(err)),
    ...overrides,
  }
}

export function buildTestApp(deps: KbDeps) {
  return buildApp(deps, { logger: false })
}

export function internalHeaders(): Record<string, string> {
  return { [HEADERS.internalToken]: TEST_CONFIG.internalToken }
}

/** What the gateway sends for a tenant admin. */
export function tenantHeaders(tenantId: string): Record<string, string> {
  return {
    ...internalHeaders(),
    [HEADERS.role]: 'tenant_admin',
    [HEADERS.adminId]: randomUUID(),
    [HEADERS.tenantId]: tenantId,
  }
}

/** What chat-service (step 3) sends: the internal token and a tenant, no admin. */
export function serviceHeaders(tenantId: string): Record<string, string> {
  return { ...internalHeaders(), [HEADERS.tenantId]: tenantId }
}
