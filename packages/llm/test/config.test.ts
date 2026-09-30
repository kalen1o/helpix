import { describe, expect, it } from 'vitest'
import { loadEmbeddingConfig } from '../src/config'

describe('loadEmbeddingConfig', () => {
  it('defaults to the fake provider at 1024 dimensions', () => {
    expect(loadEmbeddingConfig({})).toMatchObject({ provider: 'fake', model: 'hash', dimensions: 1024, batchMaxItems: 64, batchMaxTokens: 3000 })
  })

  it('defaults the openai-compatible provider to GLM embedding-3', () => {
    const c = loadEmbeddingConfig({ EMBEDDING_PROVIDER: 'openai-compatible', EMBEDDING_API_KEY: 'k' })
    expect(c).toMatchObject({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'embedding-3', dimensions: 1024 })
  })

  it('strips a trailing slash from the base URL', () => {
    const c = loadEmbeddingConfig({ EMBEDDING_PROVIDER: 'openai-compatible', EMBEDDING_API_KEY: 'k', EMBEDDING_BASE_URL: 'http://x/v1/' })
    expect(c.baseUrl).toBe('http://x/v1')
  })

  it('requires an API key for the openai-compatible provider', () => {
    expect(() => loadEmbeddingConfig({ EMBEDDING_PROVIDER: 'openai-compatible' })).toThrow('EMBEDDING_API_KEY is required')
  })

  it('rejects an unknown provider and non-positive integers', () => {
    expect(() => loadEmbeddingConfig({ EMBEDDING_PROVIDER: 'glm' })).toThrow('EMBEDDING_PROVIDER must be')
    expect(() => loadEmbeddingConfig({ EMBEDDING_DIMENSIONS: '0' })).toThrow('EMBEDDING_DIMENSIONS must be a positive integer')
    expect(() => loadEmbeddingConfig({ EMBEDDING_BATCH_MAX_ITEMS: 'ten' })).toThrow('EMBEDDING_BATCH_MAX_ITEMS must be a positive integer')
  })
})
