import type { Db } from '@helpix/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { saveTurn } from '../src/repos/messages'
import { adminHeaders, buildTestApp, customerHeaders, HIT, makeDeps, resetDb, seedConversation, setupTestDb, superAdminHeaders, TENANT_A } from './helpers'

let db: Db
let app: FastifyInstance
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(makeDeps(db))
})
afterEach(async () => { await app.close() })

const get = (url: string, headers = adminHeaders(TENANT_A)) => app.inject({ method: 'GET', url, headers })

describe('GET /chat/models', () => {
  it('lists the platform model and the allowed overrides', async () => {
    expect((await get('/chat/models')).json()).toEqual({ defaultModel: 'fake', overrides: ['big-model'] })
  })
})

describe('GET /chat/conversations', () => {
  it('lists real conversations by default and playground ones on request', async () => {
    const real = await seedConversation(db, TENANT_A, { turns: 2 })
    const pg = await seedConversation(db, TENANT_A, { playground: true })
    const list = (await get('/chat/conversations')).json()
    expect(list.conversations).toEqual([
      expect.objectContaining({ id: real.id, isPlayground: false, customerId: 'cust-1', messageCount: 4, preview: 'Q0' }),
    ])
    expect(list.nextBefore).toBeNull()
    expect((await get('/chat/conversations?kind=playground')).json().conversations.map((c: { id: string }) => c.id)).toEqual([pg.id])
  })

  it('pages with before', async () => {
    const older = await seedConversation(db, TENANT_A)
    const newer = await seedConversation(db, TENANT_A)
    const first = (await get('/chat/conversations?limit=1')).json()
    expect(first.conversations[0].id).toBe(newer.id)
    const second = (await get(`/chat/conversations?limit=1&before=${encodeURIComponent(first.nextBefore)}`)).json()
    expect(second.conversations[0].id).toBe(older.id)
  })

  it.each(['kind=archived', 'limit=0', 'limit=101', 'before=yesterday'])('rejects %s', async (query) => {
    expect((await get(`/chat/conversations?${query}`)).statusCode).toBe(400)
  })
})

describe('GET /chat/conversations/:id', () => {
  it('returns the conversation with its messages and tool activity', async () => {
    const c = await seedConversation(db, TENANT_A, { turns: 0 })
    const tools = [{ name: 'search_kb', arguments: { query: 'refunds' }, status: 'ok' as const, results: [HIT], error: null }]
    await saveTurn(db, { tenantId: TENANT_A, conversationId: c.id, userText: 'Refunds?', assistantText: 'Within 30 days.', tools, model: 'glm-4.5-air' })
    const res = await get(`/chat/conversations/${c.id}`)
    expect(res.statusCode).toBe(200)
    const detail = res.json()
    expect(detail.conversation).toMatchObject({ id: c.id, messageCount: 2, preview: 'Refunds?' })
    expect(detail.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
    expect(detail.messages[1]).toMatchObject({ content: 'Within 30 days.', model: 'glm-4.5-air', tools })
  })

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    const res = await get('/chat/conversations/00000000-0000-4000-8000-000000000999')
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('conversation_not_found')
    expect((await get('/chat/conversations/abc')).statusCode).toBe(400)
  })
})

it('admin routes are for tenant admins only', async () => {
  for (const url of ['/chat/models', '/chat/conversations']) {
    expect((await get(url, superAdminHeaders())).statusCode).toBe(403)
    expect((await get(url, customerHeaders(TENANT_A, 'cust-1'))).statusCode).toBe(403)
  }
})
