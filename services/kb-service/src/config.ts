import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEmbeddingConfig, type EmbeddingConfig } from '@helpix/llm'

/** The pgvector column is vector(1024). Another dimension needs a migration (spec §4.4), so it is refused at startup. */
export const VECTOR_DIMENSIONS = 1024

export interface KbConfig {
  port: number
  databaseUrl: string
  internalToken: string
  storageDir: string
  maxFileBytes: number
  maxDocumentsPerTenant: number
  searchTopK: number
  /** Results with a cosine similarity below this are dropped. */
  minScore: number
  jobConcurrency: number
  embedding: EmbeddingConfig
}

// <repo>/.data/kb, so `make dev` works without extra settings. Docker sets KB_STORAGE_DIR to a volume.
const DEFAULT_STORAGE_DIR = fileURLToPath(new URL('../../../.data/kb', import.meta.url))

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KbConfig {
  const required = (key: string): string => {
    const v = env[key]
    if (!v) throw new Error(`Missing required env var ${key}`)
    return v
  }
  const int = (key: string, fallback: number): number => {
    const raw = env[key]
    if (raw === undefined || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} must be a positive integer`)
    return n
  }
  const internalToken = required('INTERNAL_TOKEN')
  if (internalToken.length < 32) throw new Error('INTERNAL_TOKEN must be at least 32 characters')
  const embedding = loadEmbeddingConfig(env)
  if (embedding.dimensions !== VECTOR_DIMENSIONS) {
    throw new Error(`EMBEDDING_DIMENSIONS must be ${VECTOR_DIMENSIONS}; changing it needs a database migration (spec §4.4)`)
  }
  // Fake bag-of-words vectors score much lower than real embeddings for the same relevance.
  const minScore = Number(env.KB_MIN_SCORE ?? (embedding.provider === 'fake' ? 0.05 : 0.3))
  if (!Number.isFinite(minScore) || minScore < -1 || minScore > 1) throw new Error('KB_MIN_SCORE must be between -1 and 1')
  return {
    port: Number(env.PORT ?? 4002),
    databaseUrl: required('DATABASE_URL'),
    internalToken,
    storageDir: path.resolve(env.KB_STORAGE_DIR || DEFAULT_STORAGE_DIR),
    maxFileBytes: int('KB_MAX_FILE_BYTES', 10 * 1024 * 1024),
    maxDocumentsPerTenant: int('KB_MAX_DOCUMENTS', 200),
    searchTopK: 5,
    minScore,
    jobConcurrency: int('KB_JOB_CONCURRENCY', 2),
    embedding,
  }
}
