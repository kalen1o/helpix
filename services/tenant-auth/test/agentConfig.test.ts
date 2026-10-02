import type { FastifyInstance } from 'fastify'
import { DEFAULT_AGENT_CONFIG, type Db } from '@helpix/shared'
import type { AgentConfig } from '@helpix/shared/api-types'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  buildTestApp,
  chatCallerHeaders,
  internalHeaders,
  resetDb,
  resolverHeaders,
  seedTenant,
  setupTestDb,
  superAdminHeaders,
  tenantAdminHeaders,
} from './helpers'

let db: Db
let app: FastifyInstance

beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(db)
})
afterEach(async () => { await app.close() })

const ADMIN = '00000000-0000-4000-8000-0000000000a1'
const config = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  ...DEFAULT_AGENT_CONFIG,
  prompt: 'We sell refurbished iPhones.',
  tone: 'professional',
  ...over,
})

async function tenant(slug: string, name?: string) {
  const t = await seedTenant(db, { slug, name })
  return { id: t.id, headers: tenantAdminHeaders(ADMIN, t.id) }
}
const getConfig = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/agent/config', headers })
const putDraft = (headers: Record<string, string>, payload: unknown) =>
  app.inject({ method: 'PUT', url: '/agent/config/draft', headers, payload: payload as object })
const publish = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/agent/config/publish', headers })
const internalGet = (tenantId: string, headers = chatCallerHeaders()) =>
  app.inject({ method: 'GET', url: `/internal/agent-config/${tenantId}`, headers })

describe('tenant admin agent config', () => {
  it('returns the defaults before anything is saved', async () => {
    const a = await tenant('shop-a')
    const res = await getConfig(a.headers)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ draft: DEFAULT_AGENT_CONFIG, published: null, draftUpdatedAt: null, publishedAt: null })
  })

  it('saves the draft without touching the published config', async () => {
    const a = await tenant('shop-a')
    const saved = await putDraft(a.headers, config())
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toMatchObject({ draft: config(), published: null, draftUpdatedAt: expect.any(String) })
    expect((await getConfig(a.headers)).json().draft).toEqual(config())
  })

  it('publishes the saved draft; later draft edits stay unpublished', async () => {
    const a = await tenant('shop-a')
    await putDraft(a.headers, config())
    const pub = await publish(a.headers)
    expect(pub.statusCode).toBe(200)
    expect(pub.json()).toMatchObject({ draft: config(), published: config(), publishedAt: expect.any(String) })
    await putDraft(a.headers, config({ prompt: 'Changed' }))
    const state = (await getConfig(a.headers)).json()
    expect(state.draft.prompt).toBe('Changed')
    expect(state.published.prompt).toBe('We sell refurbished iPhones.')
  })

  it('publishes the defaults when no draft was ever saved', async () => {
    const a = await tenant('shop-a')
    expect((await publish(a.headers)).json()).toMatchObject({ draft: DEFAULT_AGENT_CONFIG, published: DEFAULT_AGENT_CONFIG })
  })

  it('trims the greeting and tone notes', async () => {
    const a = await tenant('shop-a')
    const res = await putDraft(a.headers, config({ greeting: '  Hello!  ', toneNotes: ' Use "mate". ' }))
    expect(res.json().draft).toMatchObject({ greeting: 'Hello!', toneNotes: 'Use "mate".' })
  })

  it.each([
    ['an unknown tone', { tone: 'rude' }],
    ['a colour name', { accentColor: 'red' }],
    ['a blank greeting', { greeting: '   ' }],
    ['a prompt over 8000 characters', { prompt: 'x'.repeat(8001) }],
    ['a model name with a space', { modelOverride: 'big model' }],
  ])('rejects %s and saves nothing', async (_label, patch) => {
    const a = await tenant('shop-a')
    const res = await putDraft(a.headers, { ...config(), ...patch })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
    expect((await getConfig(a.headers)).json().draftUpdatedAt).toBeNull()
  })

  it('is for tenant admins only', async () => {
    await tenant('shop-a')
    expect((await getConfig(superAdminHeaders(ADMIN))).statusCode).toBe(403)
    expect((await putDraft(superAdminHeaders(ADMIN), { nonsense: true })).statusCode).toBe(403)
    expect((await getConfig(internalHeaders())).statusCode).toBe(403)
  })

  it("keeps each tenant's config separate and ignores a tenantId in the body", async () => {
    const a = await tenant('shop-a')
    const b = await tenant('shop-b')
    await putDraft(a.headers, { ...config({ prompt: 'A only' }), tenantId: b.id })
    expect((await getConfig(b.headers)).json().draft).toEqual(DEFAULT_AGENT_CONFIG)
    expect((await getConfig(a.headers)).json().draft.prompt).toBe('A only')
  })

  it('fills fields missing from a config stored by an older version', async () => {
    const a = await tenant('shop-a')
    await db.query(`INSERT INTO tenant_auth.agent_configs (tenant_id, draft) VALUES ($1, '{"prompt":"old"}')`, [a.id])
    expect((await getConfig(a.headers)).json().draft).toEqual({ ...DEFAULT_AGENT_CONFIG, prompt: 'old' })
  })
})

describe('GET /internal/agent-config/:tenantId', () => {
  it('returns the shop name and the published config, or the defaults before publishing', async () => {
    const a = await tenant('shop-a', 'iPhone Store')
    expect((await internalGet(a.id)).json()).toEqual({ tenantName: 'iPhone Store', config: DEFAULT_AGENT_CONFIG, orderLookup: false })
    await putDraft(a.headers, config())
    expect((await internalGet(a.id)).json().config).toEqual(DEFAULT_AGENT_CONFIG)
    await publish(a.headers)
    expect((await internalGet(a.id)).json()).toEqual({ tenantName: 'iPhone Store', config: config(), orderLookup: false })
  })

  it('accepts only the chat caller', async () => {
    const a = await tenant('shop-a')
    expect((await internalGet(a.id, resolverHeaders())).statusCode).toBe(403)
    expect((await internalGet(a.id, internalHeaders())).statusCode).toBe(403)
    expect((await internalGet(a.id, { ...a.headers, 'x-internal-caller': 'gateway' })).statusCode).toBe(403)
  })

  it('reports unknown and suspended tenants', async () => {
    expect((await internalGet('00000000-0000-4000-8000-000000000999')).json().error.code).toBe('tenant_not_found')
    const s = await seedTenant(db, { slug: 'paused', status: 'suspended' })
    const res = await internalGet(s.id)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('tenant_suspended')
    expect((await internalGet('not-a-uuid')).statusCode).toBe(400)
  })
})
