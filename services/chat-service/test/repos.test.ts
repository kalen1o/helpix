import type { Db } from '@helpix/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createConversation, getConversationSummary, listConversations } from '../src/repos/conversations'
import { listMessages, recentMessages, saveTurn } from '../src/repos/messages'
import { resetDb, setupTestDb, TENANT_A, TENANT_B } from './helpers'

let db: Db
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => { await resetDb(db) })

const anon = (tenantId = TENANT_A) => createConversation(db, { tenantId, isPlayground: false, customerId: null, sessionTokenHash: 'h' })
const turn = (tenantId: string, conversationId: string, n: number) =>
  saveTurn(db, { tenantId, conversationId, userText: `Q${n}`, assistantText: `A${n}`, tools: [], model: 'fake' })

describe('schema', () => {
  it('needs exactly one owner on a real conversation and no session token in the playground', async () => {
    const make = (isPlayground: boolean, customerId: string | null, sessionTokenHash: string | null) =>
      createConversation(db, { tenantId: TENANT_A, isPlayground, customerId, sessionTokenHash })
    await expect(make(false, null, null)).rejects.toThrow(/check constraint/)
    await expect(make(false, 'c1', 'h')).rejects.toThrow(/check constraint/)
    await expect(make(true, null, 'h')).rejects.toThrow(/check constraint/)
    expect((await make(true, 'test-customer', null)).is_playground).toBe(true)
    expect((await make(false, 'c1', null)).customer_id).toBe('c1')
  })

  it("refuses a message whose tenant is not its conversation's", async () => {
    const c = await anon()
    await expect(
      db.query(`INSERT INTO chat.messages (tenant_id, conversation_id, role, content) VALUES ($1, $2, 'user', 'x')`, [TENANT_B, c.id]),
    ).rejects.toThrow(/foreign key/)
  })
})

describe('messages', () => {
  it('saves both messages of a turn in order and bumps the conversation', async () => {
    const c = await anon()
    const id = await saveTurn(db, {
      tenantId: TENANT_A,
      conversationId: c.id,
      userText: 'Refunds?',
      assistantText: 'Within 30 days.',
      tools: [{ name: 'search_kb', arguments: { query: 'refunds' }, status: 'empty', results: [], error: null }],
      model: 'glm-4.5-air',
    })
    const messages = await listMessages(db, TENANT_A, c.id)
    expect(messages.map((m) => [m.role, m.content, m.model])).toEqual([
      ['user', 'Refunds?', null],
      ['assistant', 'Within 30 days.', 'glm-4.5-air'],
    ])
    expect(messages[1]!.id).toBe(id)
    expect(messages[1]!.tools).toEqual([{ name: 'search_kb', arguments: { query: 'refunds' }, status: 'empty', results: [], error: null }])
    // Compared in SQL: JS Dates keep only milliseconds, and both timestamps can fall in the same one.
    const { rows } = await db.query<{ bumped: boolean }>('SELECT updated_at > created_at AS bumped FROM chat.conversations WHERE id = $1', [c.id])
    expect(rows[0]!.bumped).toBe(true)
  })

  it('returns the newest history in chronological order', async () => {
    const c = await anon()
    for (let n = 1; n <= 3; n++) await turn(TENANT_A, c.id, n)
    expect(await recentMessages(db, TENANT_A, c.id, 3)).toEqual([
      { role: 'assistant', content: 'A2' },
      { role: 'user', content: 'Q3' },
      { role: 'assistant', content: 'A3' },
    ])
  })

  it('scopes messages by tenant', async () => {
    const c = await anon()
    await turn(TENANT_A, c.id, 1)
    expect(await listMessages(db, TENANT_B, c.id)).toEqual([])
    expect(await recentMessages(db, TENANT_B, c.id, 10)).toEqual([])
  })
})

describe('conversation lists', () => {
  it('lists conversations that have messages, newest first, by kind, with the first user message as preview', async () => {
    const empty = await anon()
    const older = await anon()
    await turn(TENANT_A, older.id, 1)
    await turn(TENANT_A, older.id, 2)
    const newer = await createConversation(db, { tenantId: TENANT_A, isPlayground: false, customerId: 'cust-9', sessionTokenHash: null })
    await turn(TENANT_A, newer.id, 3)
    const pg = await createConversation(db, { tenantId: TENANT_A, isPlayground: true, customerId: null, sessionTokenHash: null })
    await turn(TENANT_A, pg.id, 4)

    const real = await listConversations(db, TENANT_A, { playground: false, before: null, limit: 50 })
    expect(real.conversations.map((c) => c.id)).toEqual([newer.id, older.id])
    expect(real.conversations.map((c) => c.id)).not.toContain(empty.id)
    expect(real.conversations[1]).toMatchObject({ isPlayground: false, customerId: null, messageCount: 4, preview: 'Q1' })
    expect(real.conversations[0]).toMatchObject({ customerId: 'cust-9', messageCount: 2, preview: 'Q3' })
    expect(real.nextBefore).toBeNull()

    const playground = await listConversations(db, TENANT_A, { playground: true, before: null, limit: 50 })
    expect(playground.conversations.map((c) => c.id)).toEqual([pg.id])
  })

  it('pages with nextBefore', async () => {
    const ids: string[] = []
    for (let n = 0; n < 3; n++) {
      const c = await anon()
      await turn(TENANT_A, c.id, n)
      ids.unshift(c.id)
    }
    const first = await listConversations(db, TENANT_A, { playground: false, before: null, limit: 2 })
    expect(first.conversations.map((c) => c.id)).toEqual(ids.slice(0, 2))
    expect(first.nextBefore).toEqual(expect.any(String))
    const second = await listConversations(db, TENANT_A, { playground: false, before: first.nextBefore, limit: 2 })
    expect(second.conversations.map((c) => c.id)).toEqual(ids.slice(2))
    expect(second.nextBefore).toBeNull()
  })

  it('scopes lists and summaries by tenant', async () => {
    const c = await anon()
    await turn(TENANT_A, c.id, 1)
    expect((await listConversations(db, TENANT_B, { playground: false, before: null, limit: 50 })).conversations).toEqual([])
    expect(await getConversationSummary(db, TENANT_B, c.id)).toBeNull()
    expect(await getConversationSummary(db, TENANT_A, c.id)).toMatchObject({ id: c.id, messageCount: 2 })
  })
})
