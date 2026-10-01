import type { ChatProviderConfig } from './types'

const THINKING = ['disabled', 'enabled', 'omit'] as const

/** Chat settings come only from CHAT_* (spec §3.6): the embedding provider is configured separately. */
export function loadChatConfig(env: NodeJS.ProcessEnv = process.env): ChatProviderConfig {
  const provider = env.CHAT_PROVIDER || 'fake'
  if (provider !== 'openai-compatible' && provider !== 'fake') {
    throw new Error(`CHAT_PROVIDER must be "openai-compatible" or "fake", got "${provider}"`)
  }
  const apiKey = env.CHAT_API_KEY ?? ''
  if (provider === 'openai-compatible' && !apiKey) {
    throw new Error('CHAT_API_KEY is required when CHAT_PROVIDER=openai-compatible')
  }
  const thinking = env.CHAT_THINKING || 'disabled'
  if (!(THINKING as readonly string[]).includes(thinking)) {
    throw new Error('CHAT_THINKING must be "disabled", "enabled" or "omit"')
  }
  const rawTimeout = env.CHAT_TIMEOUT_MS
  const timeoutMs = rawTimeout === undefined || rawTimeout === '' ? 60_000 : Number(rawTimeout)
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('CHAT_TIMEOUT_MS must be a positive integer')
  return {
    provider,
    baseUrl: (env.CHAT_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, ''),
    apiKey,
    model: env.CHAT_MODEL || (provider === 'fake' ? 'fake' : 'glm-4.5-air'),
    timeoutMs,
    thinking: thinking as ChatProviderConfig['thinking'],
  }
}
