import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

const ENV = { DATABASE_URL: 'postgres://x/y', INTERNAL_TOKEN: 'i'.repeat(32) }

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig(ENV)
    expect(c).toMatchObject({
      port: 4002,
      maxFileBytes: 10 * 1024 * 1024,
      maxDocumentsPerTenant: 200,
      searchTopK: 5,
      jobConcurrency: 2,
      embedding: { provider: 'fake', dimensions: 1024 },
    })
    expect(c.storageDir.endsWith(path.join('.data', 'kb'))).toBe(true)
  })

  it('uses a lower default similarity threshold for the fake provider', () => {
    expect(loadConfig(ENV).minScore).toBe(0.05)
    expect(loadConfig({ ...ENV, EMBEDDING_PROVIDER: 'openai-compatible', EMBEDDING_API_KEY: 'k' }).minScore).toBe(0.3)
    expect(loadConfig({ ...ENV, KB_MIN_SCORE: '0.5' }).minScore).toBe(0.5)
  })

  it('refuses an embedding dimension other than 1024', () => {
    expect(() => loadConfig({ ...ENV, EMBEDDING_DIMENSIONS: '2048' })).toThrow('EMBEDDING_DIMENSIONS must be 1024')
  })

  it('validates required values', () => {
    expect(() => loadConfig({ ...ENV, DATABASE_URL: undefined })).toThrow('Missing required env var DATABASE_URL')
    expect(() => loadConfig({ ...ENV, INTERNAL_TOKEN: 'short' })).toThrow('INTERNAL_TOKEN must be at least 32 characters')
    expect(() => loadConfig({ ...ENV, KB_MIN_SCORE: '2' })).toThrow('KB_MIN_SCORE must be between -1 and 1')
    expect(() => loadConfig({ ...ENV, KB_MAX_FILE_BYTES: '-5' })).toThrow('KB_MAX_FILE_BYTES must be a positive integer')
  })

  it('resolves KB_STORAGE_DIR to an absolute path', () => {
    expect(loadConfig({ ...ENV, KB_STORAGE_DIR: '/data/kb' }).storageDir).toBe('/data/kb')
    expect(path.isAbsolute(loadConfig({ ...ENV, KB_STORAGE_DIR: 'rel/kb' }).storageDir)).toBe(true)
  })
})
