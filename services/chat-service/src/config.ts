import { loadChatConfig, type ChatProviderConfig } from '@helpix/llm'
import { MODEL_NAME_PATTERN } from '@helpix/shared'

export interface ChatServiceConfig {
  port: number
  databaseUrl: string
  internalToken: string
  tenantAuthUrl: string
  kbServiceUrl: string
  llm: ChatProviderConfig
  /** Models a tenant may pick as an override (CHAT_MODEL_OVERRIDES); any other override uses `llm.model`. */
  modelOverrides: string[]
  maxToolRounds: number
  historyMaxMessages: number
  /** Estimated tokens of history sent with each turn (spec §3.3). */
  historyTokenBudget: number
  configCacheTtlMs: number
  kbTimeoutMs: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ChatServiceConfig {
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
  const modelName = new RegExp(MODEL_NAME_PATTERN)
  const modelOverrides = (env.CHAT_MODEL_OVERRIDES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  for (const m of modelOverrides) {
    if (!modelName.test(m)) throw new Error(`CHAT_MODEL_OVERRIDES has an invalid model name: "${m}"`)
  }
  return {
    port: Number(env.PORT ?? 4003),
    databaseUrl: required('DATABASE_URL'),
    internalToken,
    tenantAuthUrl: required('TENANT_AUTH_URL').replace(/\/$/, ''),
    kbServiceUrl: required('KB_SERVICE_URL').replace(/\/$/, ''),
    llm: loadChatConfig(env),
    modelOverrides,
    maxToolRounds: int('CHAT_MAX_TOOL_ROUNDS', 3),
    historyMaxMessages: int('CHAT_HISTORY_MAX_MESSAGES', 20),
    historyTokenBudget: int('CHAT_HISTORY_TOKEN_BUDGET', 3000),
    configCacheTtlMs: int('CHAT_CONFIG_CACHE_TTL_MS', 10_000),
    kbTimeoutMs: int('CHAT_KB_TIMEOUT_MS', 5000),
  }
}
