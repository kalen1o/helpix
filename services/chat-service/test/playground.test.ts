import { createScriptedChat, type ChatEvent } from '@helpix/llm'
import { DEFAULT_AGENT_CONFIG, type Db } from '@helpix/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { listMessages } from '../src/repos/messages'
import { adminHeaders, buildTestApp, customerHeaders, fakeConfigs, fakeOrders, makeDeps, ORDER, parseEvents, resetDb, setupTestDb, superAdminHeaders, TENANT_A } from './helpers'

let db: Db
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => { await resetDb(db) })

const answer = (t: string): ChatEvent[] => [{ type: 'text', text: t }, { type: 'done', finishReason: 'stop' }]
const body = (over: object = {}) => ({
  message: 'Do you ship to Hanoi?',
  config: { ...DEFAULT_AGENT_CONFIG, prompt: 'DRAFT-ONLY instructions' },
  ...over,
})
const post = (app: FastifyInstance, headers: Record<string, string>, payload: object) =>
  app.inject({ method: 'POST', url: '/chat/playground', headers, payload })

describe('POST /chat/playground', () => {
  it('runs on the config in the request body, not the published one', async () => {
    const chat = createScriptedChat(() => answer('Yes.'))
    const app = await buildTestApp(makeDeps(db, { chat, agentConfigs: fakeConfigs({ prompt: 'PUBLISHED instructions' }, 'Teen Fashion') }))
    const res = await post(app, adminHeaders(TENANT_A), body())
    expect(res.statusCode).toBe(200)
    const system = chat.requests[0]!.messages[0]!.content
    expect(system).toContain('DRAFT-ONLY instructions')
    expect(system).not.toContain('PUBLISHED instructions')
    expect(system).toContain('customer support assistant for Teen Fashion.')
    await app.close()
  })

  it('stores a playground conversation with the test customer id, and continues it', async () => {
    const app = await buildTestApp(makeDeps(db, { chat: createScriptedChat(() => answer('Yes.')) }))
    const first = await parseEvents((await post(app, adminHeaders(TENANT_A), body({ customerId: ' test-cust ' }))).payload)
    const { conversationId, sessionToken } = first[0]!.data
    expect(sessionToken).toBeUndefined()
    const { rows } = await db.query('SELECT is_playground, customer_id FROM chat.conversations WHERE id = $1', [conversationId])
    expect(rows[0]).toEqual({ is_playground: true, customer_id: 'test-cust' })

    const second = await parseEvents((await post(app, adminHeaders(TENANT_A), body({ message: 'And Da Nang?', conversationId }))).payload)
    expect(second.at(-1)!.event).toBe('done')
    expect(await listMessages(db, TENANT_A, conversationId)).toHaveLength(4)
    await app.close()
  })

  it("applies the draft's model override", async () => {
    const chat = createScriptedChat(() => answer('ok'))
    const app = await buildTestApp(makeDeps(db, { chat }))
    await post(app, adminHeaders(TENANT_A), body({ config: { ...DEFAULT_AGENT_CONFIG, modelOverride: 'big-model' } }))
    expect(chat.requests[0]!.model).toBe('big-model')
    await app.close()
  })

  it('is for tenant admins only', async () => {
    const app = await buildTestApp(makeDeps(db))
    expect((await post(app, superAdminHeaders(), body())).statusCode).toBe(403)
    expect((await post(app, customerHeaders(TENANT_A, 'cust-1'), body())).statusCode).toBe(403)
    await app.close()
  })

  it('validates the draft config', async () => {
    const app = await buildTestApp(makeDeps(db))
    const res = await post(app, adminHeaders(TENANT_A), body({ config: { ...DEFAULT_AGENT_CONFIG, accentColor: 'mint' } }))
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('turns on lookup_order for the test customer when the shop has order lookup', async () => {
    const orders = fakeOrders({ status: 'ok', orders: [ORDER] })
    const chat = createScriptedChat((_req, call) =>
      call === 0
        ? [{ type: 'tool_call', call: { id: 'c1', name: 'lookup_order', arguments: '{}' } }, { type: 'done', finishReason: 'tool_calls' }]
        : answer('You have one order.'),
    )
    const app = await buildTestApp(makeDeps(db, { chat, orders, agentConfigs: fakeConfigs({}, 'Test Shop', true) }))
    const events = await parseEvents((await post(app, adminHeaders(TENANT_A), body({ customerId: ' cust_maya ' }))).payload)
    expect(chat.requests[0]!.tools!.map((t) => t.name)).toEqual(['search_kb', 'lookup_order'])
    expect(orders.calls).toEqual([{ kind: 'list', tenantId: TENANT_A, customerId: 'cust_maya', orderId: null }])
    expect(events.find((e) => e.event === 'tool' && e.data.name === 'lookup_order')!.data.orders).toEqual([{ orderId: '1001', status: 'shipped' }])
    await app.close()
  })

  it('does not offer lookup_order without a test customer, or when the shop has no order API', async () => {
    for (const [customerId, orderLookup] of [[null, true], ['cust_maya', false]] as const) {
      const chat = createScriptedChat(() => answer('ok'))
      const app = await buildTestApp(makeDeps(db, { chat, agentConfigs: fakeConfigs({}, 'Test Shop', orderLookup) }))
      await post(app, adminHeaders(TENANT_A), body({ customerId }))
      expect(chat.requests[0]!.tools!.map((t) => t.name)).toEqual(['search_kb'])
      await app.close()
    }
  })

  it("tells the model the test customer's sign-in state, without the customer id", async () => {
    const cases = [
      [' cust_maya ', true, 'The customer is signed in on Test Shop and verified.'],
      [null, true, 'The customer is not signed in, so you cannot see any orders.'],
      [null, false, 'Test Shop has not connected its order system'],
      ['cust_maya', false, 'Test Shop has not connected its order system'],
    ] as const
    for (const [customerId, orderLookup, expected] of cases) {
      const chat = createScriptedChat(() => answer('ok'))
      const app = await buildTestApp(makeDeps(db, { chat, agentConfigs: fakeConfigs({}, 'Test Shop', orderLookup) }))
      await post(app, adminHeaders(TENANT_A), body({ customerId }))
      const system = chat.requests[0]!.messages[0]!.content
      expect(system).toContain(expected)
      expect(system).not.toContain('cust_maya')
      await app.close()
    }
  })
})
