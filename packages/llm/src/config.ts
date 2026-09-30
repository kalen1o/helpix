import type { EmbeddingConfig } from './types'

export function loadEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig {
  const provider = env.EMBEDDING_PROVIDER ?? 'fake'
  if (provider !== 'openai-compatible' && provider !== 'fake') {
    throw new Error(`EMBEDDING_PROVIDER must be "openai-compatible" or "fake", got "${provider}"`)
  }
  const apiKey = env.EMBEDDING_API_KEY ?? ''
  if (provider === 'openai-compatible' && !apiKey) {
    throw new Error('EMBEDDING_API_KEY is required when EMBEDDING_PROVIDER=openai-compatible')
  }
  const int = (key: string, fallback: number): number => {
    const raw = env[key]
    if (raw === undefined || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} must be a positive integer`)
    return n
  }
  return {
    provider,
    baseUrl: (env.EMBEDDING_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, ''),
    apiKey,
    model: env.EMBEDDING_MODEL ?? (provider === 'fake' ? 'hash' : 'embedding-3'),
    dimensions: int('EMBEDDING_DIMENSIONS', 1024),
    // GLM embedding-3: at most 64 inputs and 3072 tokens per request.
    batchMaxItems: int('EMBEDDING_BATCH_MAX_ITEMS', 64),
    batchMaxTokens: int('EMBEDDING_BATCH_MAX_TOKENS', 3000),
    timeoutMs: int('EMBEDDING_TIMEOUT_MS', 30_000),
  }
}
