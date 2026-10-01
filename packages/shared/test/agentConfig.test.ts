import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { AGENT_CONFIG_SCHEMA, DEFAULT_AGENT_CONFIG, sameAgentConfig, withAgentDefaults } from '../src/agent-config'

/** Runs a body through Fastify's real validator, the way tenant-auth and chat-service will. */
async function validate(body: unknown): Promise<number> {
  const app = Fastify()
  app.put('/x', { schema: { body: AGENT_CONFIG_SCHEMA } }, async () => ({ ok: true }))
  const res = await app.inject({ method: 'PUT', url: '/x', payload: body as object })
  await app.close()
  return res.statusCode
}

describe('AGENT_CONFIG_SCHEMA', () => {
  it('accepts the defaults and a valid override', async () => {
    expect(await validate(DEFAULT_AGENT_CONFIG)).toBe(200)
    expect(await validate({ ...DEFAULT_AGENT_CONFIG, modelOverride: 'glm-4.6' })).toBe(200)
  })

  it.each([
    ['an unknown tone', { tone: 'rude' }],
    ['a colour name', { accentColor: 'red' }],
    ['a short hex colour', { accentColor: '#0c9' }],
    ['a blank greeting', { greeting: '   ' }],
    ['a greeting over 300 characters', { greeting: 'x'.repeat(301) }],
    ['a prompt over 8000 characters', { prompt: 'x'.repeat(8001) }],
    ['tone notes over 500 characters', { toneNotes: 'x'.repeat(501) }],
    ['a model name with a space', { modelOverride: 'big model' }],
    ['an empty model name', { modelOverride: '' }],
  ])('rejects %s', async (_label, patch) => {
    expect(await validate({ ...DEFAULT_AGENT_CONFIG, ...patch })).toBe(400)
  })

  it('rejects a body with a field missing', async () => {
    const { tone: _tone, ...rest } = DEFAULT_AGENT_CONFIG
    expect(await validate(rest)).toBe(400)
  })
})

describe('withAgentDefaults', () => {
  it('fills missing fields, replaces an unknown tone and drops unknown fields', () => {
    const stored = { prompt: 'Hi', tone: 'grumpy', extra: 1 } as unknown as Parameters<typeof withAgentDefaults>[0]
    expect(withAgentDefaults(stored)).toEqual({ ...DEFAULT_AGENT_CONFIG, prompt: 'Hi' })
  })

  it('returns the defaults for null', () => {
    expect(withAgentDefaults(null)).toEqual(DEFAULT_AGENT_CONFIG)
  })
})

describe('sameAgentConfig', () => {
  it('compares every field', () => {
    expect(sameAgentConfig(DEFAULT_AGENT_CONFIG, { ...DEFAULT_AGENT_CONFIG })).toBe(true)
    expect(sameAgentConfig(DEFAULT_AGENT_CONFIG, { ...DEFAULT_AGENT_CONFIG, modelOverride: 'm' })).toBe(false)
    expect(sameAgentConfig(DEFAULT_AGENT_CONFIG, { ...DEFAULT_AGENT_CONFIG, toneNotes: ' ' })).toBe(false)
  })
})
