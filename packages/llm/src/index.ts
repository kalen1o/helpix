import { createFakeChat } from './chat/fake'
import { createOpenAICompatibleChat } from './chat/openaiCompatible'
import type { ChatProvider, ChatProviderConfig } from './chat/types'
import { createFakeEmbeddings } from './fake'
import { createOpenAICompatibleEmbeddings } from './openaiCompatible'
import type { EmbeddingConfig, EmbeddingProvider } from './types'

export * from './types'
export * from './tokens'
export { batchTexts } from './batch'
export { loadEmbeddingConfig } from './config'
export { createFakeEmbeddings } from './fake'
export { createOpenAICompatibleEmbeddings } from './openaiCompatible'

export * from './chat/types'
export { loadChatConfig } from './chat/config'
export { createOpenAICompatibleChat } from './chat/openaiCompatible'
export { createFakeChat } from './chat/fake'
export { createScriptedChat, type ScriptedChat, type ScriptedRound } from './chat/scripted'

export function createEmbeddingProvider(config: EmbeddingConfig, fetchImpl?: typeof fetch): EmbeddingProvider {
  return config.provider === 'fake' ? createFakeEmbeddings(config) : createOpenAICompatibleEmbeddings(config, fetchImpl)
}

export function createChatProvider(config: ChatProviderConfig, fetchImpl?: typeof fetch): ChatProvider {
  return config.provider === 'fake' ? createFakeChat(config.model) : createOpenAICompatibleChat(config, fetchImpl)
}
