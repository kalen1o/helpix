import { createFakeEmbeddings } from './fake'
import { createOpenAICompatibleEmbeddings } from './openaiCompatible'
import type { EmbeddingConfig, EmbeddingProvider } from './types'

export * from './types'
export * from './tokens'
export { batchTexts } from './batch'
export { loadEmbeddingConfig } from './config'
export { createFakeEmbeddings } from './fake'
export { createOpenAICompatibleEmbeddings } from './openaiCompatible'

export function createEmbeddingProvider(config: EmbeddingConfig, fetchImpl?: typeof fetch): EmbeddingProvider {
  return config.provider === 'fake' ? createFakeEmbeddings(config) : createOpenAICompatibleEmbeddings(config, fetchImpl)
}
