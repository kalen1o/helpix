import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

const ENV = {
  INTERNAL_TOKEN: 'i'.repeat(32),
  DATABASE_URL: 'postgres://h:h@localhost:5433/helpix',
  TENANT_AUTH_URL: 'http://tenant-auth:4001',
  KB_SERVICE_URL: 'http://kb-service:4002',
}

describe('loadConfig', () => {
  it('uses the defaults', () => {
    expect(loadConfig(ENV)).toMatchObject({
      port: 4003,
      tenantAuthUrl: 'http://tenant-auth:4001',
      kbServiceUrl: 'http://kb-service:4002',
      llm: { provider: 'fake', model: 'fake' },
      modelOverrides: [],
      maxToolRounds: 3,
      historyMaxMessages: 20,
      historyTokenBudget: 3000,
      configCacheTtlMs: 10_000,
      kbTimeoutMs: 5000,
    })
  })

  it('reads the allowed model overrides', () => {
    expect(loadConfig({ ...ENV, CHAT_MODEL_OVERRIDES: ' glm-4.5 , glm-4.6,, ' }).modelOverrides).toEqual(['glm-4.5', 'glm-4.6'])
  })

  it('rejects an override that is not a model name', () => {
    expect(() => loadConfig({ ...ENV, CHAT_MODEL_OVERRIDES: 'glm 4' })).toThrow('CHAT_MODEL_OVERRIDES has an invalid model name: "glm 4"')
  })

  it.each(['INTERNAL_TOKEN', 'DATABASE_URL', 'TENANT_AUTH_URL', 'KB_SERVICE_URL'])('requires %s', (key) => {
    expect(() => loadConfig({ ...ENV, [key]: undefined })).toThrow(`Missing required env var ${key}`)
  })

  it('rejects a short internal token', () => {
    expect(() => loadConfig({ ...ENV, INTERNAL_TOKEN: 'short' })).toThrow('INTERNAL_TOKEN must be at least 32 characters')
  })

  it.each(['CHAT_MAX_TOOL_ROUNDS', 'CHAT_HISTORY_MAX_MESSAGES', 'CHAT_HISTORY_TOKEN_BUDGET', 'CHAT_CONFIG_CACHE_TTL_MS', 'CHAT_KB_TIMEOUT_MS'])(
    'rejects a non-positive %s',
    (key) => {
      for (const bad of ['0', '-1', '1.5', 'x']) expect(() => loadConfig({ ...ENV, [key]: bad })).toThrow(`${key} must be a positive integer`)
    },
  )
})
