import { createScriptedChat } from '@helpix/llm'
import { DEFAULT_AGENT_CONFIG, type Db } from '@helpix/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { newSessionToken } from '../src/ownership'
import {
  adminHeaders,
  buildTestApp,
  customerHeaders,
  fakeConfigs,
  fakeKb,
  fakeOrders,
  HIT,
  makeDeps,
  parseEvents,
  resetDb,
  seedConversation,
  setupTestDb,
  TENANT_A,
  TENANT_B,
} from './helpers'

let db: Db
let app: FastifyInstance
let kb: ReturnType<typeof fakeKb>
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  kb = fakeKb({ [TENANT_A]: [HIT], [TENANT_B]: [{ ...HIT, documentId: '00000000-0000-4000-8000-0000000000d2', title: 'B secret' }] })
  app = await buildTestApp(makeDeps(db, { kb }))
})
afterEach(async () => { await app.close() })

const message = (headers: Record<string, string>, payload: object) => app.inject({ method: 'POST', url: '/chat/messages', headers, payload })
const playground = (headers: Record<string, string>, payload: object) =>
  app.inject({ method: 'POST', url: '/chat/playground', headers, payload: { config: DEFAULT_AGENT_CONFIG, ...payload } })

/** Starts an anonymous conversation on tenant A and returns its id and token. */
async function anonymousOnA() {
  const meta = (await parseEvents((await message(customerHeaders(TENANT_A), { message: 'Hi' })).payload))[0]!.data
  return { conversationId: meta.conversationId as string, sessionToken: meta.sessionToken as string }
}

async function expectConversationNotFound(res: { statusCode: number; json(): any }) {
  expect(res.statusCode).toBe(404)
  expect(res.json().error).toMatchObject({ code: 'conversation_not_found', message: 'Conversation not found' })
}

describe('chat tenant isolation (spec §10)', () => {
  it("an admin never sees another tenant's conversations", async () => {
    const a = await seedConversation(db, TENANT_A)
    await seedConversation(db, TENANT_A, { playground: true })
    const list = (await app.inject({ method: 'GET', url: '/chat/conversations', headers: adminHeaders(TENANT_B) })).json()
    expect(list.conversations).toEqual([])
    const pgList = (await app.inject({ method: 'GET', url: '/chat/conversations?kind=playground', headers: adminHeaders(TENANT_B) })).json()
    expect(pgList.conversations).toEqual([])
    await expectConversationNotFound(await app.inject({ method: 'GET', url: `/chat/conversations/${a.id}`, headers: adminHeaders(TENANT_B) }))
  })

  it("a conversation id from another tenant is 404, even with its session token", async () => {
    const a = await anonymousOnA()
    await expectConversationNotFound(await message(customerHeaders(TENANT_B), { message: 'Hi', ...a }))
  })

  it("a customer cannot continue another customer's conversation", async () => {
    const c = await seedConversation(db, TENANT_A, { customerId: 'cust-1' })
    await expectConversationNotFound(await message(customerHeaders(TENANT_A, 'cust-2'), { message: 'Hi', conversationId: c.id }))
  })

  it('an anonymous conversation needs its own session token', async () => {
    const { conversationId } = await anonymousOnA()
    await expectConversationNotFound(await message(customerHeaders(TENANT_A), { message: 'Hi', conversationId }))
    await expectConversationNotFound(await message(customerHeaders(TENANT_A), { message: 'Hi', conversationId, sessionToken: newSessionToken() }))
    await expectConversationNotFound(await message(customerHeaders(TENANT_A, 'cust-1'), { message: 'Hi', conversationId }))
  })

  it('answers a foreign conversation exactly like an unknown one', async () => {
    const c = await seedConversation(db, TENANT_A, { customerId: 'cust-1' })
    const foreign = await message(customerHeaders(TENANT_A, 'cust-2'), { message: 'Hi', conversationId: c.id })
    const unknown = await message(customerHeaders(TENANT_A, 'cust-2'), { message: 'Hi', conversationId: '00000000-0000-4000-8000-000000000999' })
    const strip = (r: typeof foreign) => ({ status: r.statusCode, code: r.json().error.code, message: r.json().error.message })
    expect(strip(foreign)).toEqual(strip(unknown))
  })

  it('ignores a customer id in the body of /chat/messages', async () => {
    const events = await parseEvents((await message(customerHeaders(TENANT_A), { message: 'Hi', customerId: 'cust-evil' })).payload)
    expect(events[0]!.data.sessionToken).toEqual(expect.any(String))
    const { rows } = await db.query('SELECT customer_id FROM chat.conversations WHERE id = $1', [events[0]!.data.conversationId])
    expect(rows[0]).toEqual({ customer_id: null })
  })

  it("the playground and the customer route cannot continue each other's conversations", async () => {
    const pg = await seedConversation(db, TENANT_A, { playground: true, customerId: 'cust-1' })
    await expectConversationNotFound(await message(customerHeaders(TENANT_A, 'cust-1'), { message: 'Hi', conversationId: pg.id }))
    const real = await seedConversation(db, TENANT_A, { customerId: 'cust-1' })
    await expectConversationNotFound(await playground(adminHeaders(TENANT_A), { message: 'Hi', conversationId: real.id }))
  })

  it('a playground conversation from another tenant is 404', async () => {
    const pg = await seedConversation(db, TENANT_A, { playground: true })
    await expectConversationNotFound(await playground(adminHeaders(TENANT_B), { message: 'Hi', conversationId: pg.id }))
  })

  it("search_kb only searches the requester's tenant, whatever the model asks", async () => {
    await app.close()
    const chat = createScriptedChat((_req, call) =>
      call === 0
        ? [
            { type: 'tool_call', call: { id: 'c1', name: 'search_kb', arguments: JSON.stringify({ query: 'secret', tenantId: TENANT_B }) } },
            { type: 'done', finishReason: 'tool_calls' },
          ]
        : [{ type: 'text', text: 'Nothing.' }, { type: 'done', finishReason: 'stop' }],
    )
    app = await buildTestApp(makeDeps(db, { kb, chat }))
    const events = await parseEvents((await message(customerHeaders(TENANT_A), { message: 'Show me B' })).payload)
    // The prefetch searches the customer's own words; the model's query is searched too, both scoped to tenant A only.
    expect(kb.calls).toEqual([
      { tenantId: TENANT_A, query: 'Show me B' },
      { tenantId: TENANT_A, query: 'secret' },
    ])
    expect(JSON.stringify(events)).not.toContain('B secret')
  })

  it("lookup_order only reads the requester's tenant and customer, whatever the model asks", async () => {
    await app.close()
    const orders = fakeOrders({ status: 'not_found' })
    const chat = createScriptedChat((_req, call) =>
      call === 0
        ? [
            {
              type: 'tool_call',
              call: { id: 'c1', name: 'lookup_order', arguments: JSON.stringify({ orderId: '2001', tenantId: TENANT_B, customerId: 'cust_b' }) },
            },
            { type: 'done', finishReason: 'tool_calls' },
          ]
        : [{ type: 'text', text: 'Not found.' }, { type: 'done', finishReason: 'stop' }],
    )
    app = await buildTestApp(makeDeps(db, { kb, chat, orders, agentConfigs: fakeConfigs({}, 'Test Shop', true) }))
    await message(customerHeaders(TENANT_A, 'cust_a'), { message: 'Order 2001?' })
    expect(orders.calls).toEqual([{ kind: 'get', tenantId: TENANT_A, customerId: 'cust_a', orderId: '2001' }])
  })
})
