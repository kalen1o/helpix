import { describe, expect, it } from 'vitest'
import { loadChatConfig } from '../src/chat/config'

describe('loadChatConfig', () => {
  it('defaults to the offline fake', () => {
    expect(loadChatConfig({})).toEqual({
      provider: 'fake',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: '',
      model: 'fake',
      timeoutMs: 60_000,
      thinking: 'disabled',
    })
  })

  it('reads an openai-compatible setup and defaults the model to glm-4.5-air', () => {
    const c = loadChatConfig({ CHAT_PROVIDER: 'openai-compatible', CHAT_API_KEY: 'k', CHAT_BASE_URL: 'https://api.example/v1/', CHAT_MODEL: '' })
    expect(c).toMatchObject({ provider: 'openai-compatible', apiKey: 'k', baseUrl: 'https://api.example/v1', model: 'glm-4.5-air' })
  })

  it('reads the model, timeout and thinking mode', () => {
    const c = loadChatConfig({ CHAT_MODEL: 'glm-4.6', CHAT_TIMEOUT_MS: '5000', CHAT_THINKING: 'omit' })
    expect(c).toMatchObject({ model: 'glm-4.6', timeoutMs: 5000, thinking: 'omit' })
  })

  it('requires a key for openai-compatible and never reads EMBEDDING_API_KEY', () => {
    expect(() => loadChatConfig({ CHAT_PROVIDER: 'openai-compatible', EMBEDDING_API_KEY: 'k' })).toThrow(
      'CHAT_API_KEY is required when CHAT_PROVIDER=openai-compatible',
    )
  })

  it.each([
    [{ CHAT_PROVIDER: 'anthropic' }, 'CHAT_PROVIDER must be "openai-compatible" or "fake"'],
    [{ CHAT_THINKING: 'maybe' }, 'CHAT_THINKING must be "disabled", "enabled" or "omit"'],
    [{ CHAT_TIMEOUT_MS: '0' }, 'CHAT_TIMEOUT_MS must be a positive integer'],
    [{ CHAT_TIMEOUT_MS: 'soon' }, 'CHAT_TIMEOUT_MS must be a positive integer'],
  ])('rejects %j', (env, message) => {
    expect(() => loadChatConfig(env)).toThrow(message)
  })
})
