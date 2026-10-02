import type { AddressInfo } from 'node:net'
import { ChatError, createScriptedChat, type ChatEvent, type ChatProvider } from '@helpix/llm'
import { AppError, type Db } from '@helpix/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ORDER_NOT_FOUND, ORDERS_UNAVAILABLE } from '../src/agent/lookupOrder'
import { listMessages } from '../src/repos/messages'
import {
  adminHeaders,
  buildTestApp,
  customerHeaders,
  fakeConfigs,
  fakeKb,
  fakeOrders,
  HIT,
  internalHeaders,
  makeDeps,
  ORDER,
  parseEvents,
  replyText,
  resetDb,
  setupTestDb,
  TENANT_A,
} from './helpers'

let db: Db
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => { await resetDb(db) })

const send = (app: FastifyInstance, headers: Record<string, string>, payload: object) =>
  app.inject({ method: 'POST', url: '/chat/messages', headers, payload })
const answer = (t: string): ChatEvent[] => [{ type: 'text', text: t }, { type: 'done', finishReason: 'stop' }]
const callLookup = (args: object): ChatEvent[] => [
  { type: 'tool_call', call: { id: 'c1', name: 'lookup_order', arguments: JSON.stringify(args) } },
  { type: 'done', finishReason: 'tool_calls' },
]
const messageCount = async () => (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM chat.messages')).rows[0]!.n

describe('POST /chat/messages', () => {
  it('starts an anonymous conversation and streams meta, the tool, the reply and done', async () => {
    const kb = fakeKb({ [TENANT_A]: [HIT] })
    const app = await buildTestApp(makeDeps(db, { kb }))
    const res = await send(app, customerHeaders(TENANT_A), { message: '  Can I get a refund?  ' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(res.headers['x-request-id']).toEqual(expect.any(String))

    const events = await parseEvents(res.payload)
    expect(events[0]).toEqual({ event: 'meta', data: { conversationId: expect.any(String), sessionToken: expect.any(String) } })
    expect(events.find((e) => e.event === 'tool')!.data).toEqual({
      name: 'search_kb',
      status: 'ok',
      sources: [{ documentId: HIT.documentId, title: 'Return policy' }],
    })
    expect(replyText(events)).toBe('From "Return policy": Refunds within 30 days.')
    expect(events.at(-1)).toEqual({ event: 'done', data: { messageId: expect.any(String) } })
    expect(kb.calls).toEqual([{ tenantId: TENANT_A, query: 'Can I get a refund?' }])

    const stored = await listMessages(db, TENANT_A, events[0]!.data.conversationId)
    expect(stored.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Can I get a refund?'],
      ['assistant', 'From "Return policy": Refunds within 30 days.'],
    ])
    expect(stored[1]!).toMatchObject({ id: events.at(-1)!.data.messageId, model: 'fake' })
    expect(stored[1]!.tools).toEqual([{ name: 'search_kb', arguments: { query: 'Can I get a refund?' }, status: 'ok', results: [HIT], error: null }])
    await app.close()
  })

  it('searches the knowledge base with the message even when the model would answer without calling a tool', async () => {
    const kb = fakeKb({ [TENANT_A]: [HIT] })
    const chat = createScriptedChat(() => answer('Refunds within 30 days.'))
    const app = await buildTestApp(makeDeps(db, { kb, chat }))
    const events = await parseEvents((await send(app, customerHeaders(TENANT_A), { message: 'Refund policy?' })).payload)
    expect(kb.calls).toEqual([{ tenantId: TENANT_A, query: 'Refund policy?' }])
    expect(events.find((e) => e.event === 'tool')!.data).toMatchObject({ name: 'search_kb', status: 'ok' })
    expect(chat.requests[0]!.messages.slice(-2)).toEqual([
      { role: 'assistant', content: '', toolCalls: [{ id: expect.any(String), name: 'search_kb', arguments: '{"query":"Refund policy?"}' }] },
      { role: 'tool', toolCallId: expect.any(String), content: expect.stringContaining('Refunds within 30 days.') },
    ])
    const stored = await listMessages(db, TENANT_A, events[0]!.data.conversationId)
    expect(stored[1]!.tools).toEqual([{ name: 'search_kb', arguments: { query: 'Refund policy?' }, status: 'ok', results: [HIT], error: null }])
    await app.close()
  })

  it('continues the conversation with its session token and sends the history to the model', async () => {
    const chat = createScriptedChat((_req, call) => answer(`Answer ${call}`))
    const app = await buildTestApp(makeDeps(db, { chat }))
    const first = await parseEvents((await send(app, customerHeaders(TENANT_A), { message: 'First?' })).payload)
    const { conversationId, sessionToken } = first[0]!.data
    const second = await parseEvents((await send(app, customerHeaders(TENANT_A), { message: 'Second?', conversationId, sessionToken })).payload)
    expect(second[0]).toEqual({ event: 'meta', data: { conversationId } })
    expect(replyText(second)).toBe('Answer 1')
    // History, then the new message; the prefetched search pair follows it.
    expect(chat.requests[1]!.messages.slice(1, 4)).toEqual([
      { role: 'user', content: 'First?' },
      { role: 'assistant', content: 'Answer 0' },
      { role: 'user', content: 'Second?' },
    ])
    expect(chat.requests[1]!.messages.slice(4).map((m) => m.role)).toEqual(['assistant', 'tool'])
    await app.close()
  })

  it('gives a logged-in customer no session token and keys the conversation to the customer id', async () => {
    const app = await buildTestApp(makeDeps(db, { chat: createScriptedChat(() => answer('Hi!')) }))
    const first = await parseEvents((await send(app, customerHeaders(TENANT_A, 'cust-1'), { message: 'Hello' })).payload)
    expect(first[0]!.data.sessionToken).toBeUndefined()
    const { rows } = await db.query('SELECT customer_id, session_token_hash FROM chat.conversations WHERE id = $1', [first[0]!.data.conversationId])
    expect(rows[0]).toEqual({ customer_id: 'cust-1', session_token_hash: null })
    const again = await parseEvents(
      (await send(app, customerHeaders(TENANT_A, 'cust-1'), { message: 'Again', conversationId: first[0]!.data.conversationId })).payload,
    )
    expect(again.at(-1)!.event).toBe('done')
    await app.close()
  })

  it('reports a model failure as an error event and stores nothing', async () => {
    const chat = createScriptedChat([[{ type: 'text', text: 'Partial' }, new ChatError('The chat model returned HTTP 503', true)]])
    const app = await buildTestApp(makeDeps(db, { chat }))
    const events = await parseEvents((await send(app, customerHeaders(TENANT_A), { message: 'Hello' })).payload)
    expect(events.map((e) => e.event)).toEqual(['meta', 'tool', 'delta', 'error'])
    expect(events[3]!.data).toEqual({ code: 'llm_unavailable', message: 'The assistant is unavailable right now. Please try again.' })
    expect(JSON.stringify(events)).not.toContain('503')
    expect(await messageCount()).toBe(0)
    await app.close()
  })

  it('still answers when the knowledge base is down', async () => {
    const app = await buildTestApp(makeDeps(db, { kb: fakeKb({}, { down: true }) }))
    const events = await parseEvents((await send(app, customerHeaders(TENANT_A), { message: 'Warranty?' })).payload)
    expect(events.find((e) => e.event === 'tool')!.data).toEqual({ name: 'search_kb', status: 'error', sources: [] })
    expect(replyText(events)).not.toBe('')
    expect(events.at(-1)!.event).toBe('done')
    await app.close()
  })

  it("uses the tenant's model override only when the platform allows it", async () => {
    for (const [override, expected] of [['big-model', 'big-model'], ['other-model', 'scripted']] as const) {
      const chat = createScriptedChat(() => answer('ok'))
      const app = await buildTestApp(makeDeps(db, { chat, agentConfigs: fakeConfigs({ modelOverride: override }) }))
      const events = await parseEvents((await send(app, customerHeaders(TENANT_A), { message: 'Hi' })).payload)
      expect(chat.requests[0]!.model).toBe(expected)
      const stored = await listMessages(db, TENANT_A, events[0]!.data.conversationId)
      expect(stored[1]!.model).toBe(expected)
      await app.close()
    }
  })

  it('refuses with a JSON error, before streaming, when the shop is suspended', async () => {
    const agentConfigs = {
      getPublished: async () => {
        throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
      },
    }
    const app = await buildTestApp(makeDeps(db, { agentConfigs }))
    const res = await send(app, customerHeaders(TENANT_A), { message: 'Hi' })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('tenant_suspended')
    expect((await db.query('SELECT 1 FROM chat.conversations')).rowCount).toBe(0)
    await app.close()
  })

  it('refuses admins (they use the playground) and requests without a tenant', async () => {
    const app = await buildTestApp(makeDeps(db))
    expect((await send(app, adminHeaders(TENANT_A), { message: 'Hi' })).statusCode).toBe(403)
    expect((await send(app, internalHeaders(), { message: 'Hi' })).statusCode).toBe(403)
    await app.close()
  })

  it.each([
    ['no message', {}],
    ['an empty message', { message: '' }],
    ['a blank message', { message: '   ' }],
    ['a message over 2000 characters', { message: 'x'.repeat(2001) }],
    ['a malformed conversation id', { message: 'Hi', conversationId: 'abc' }],
  ])('rejects %s with 400', async (_label, payload) => {
    const app = await buildTestApp(makeDeps(db))
    const res = await send(app, customerHeaders(TENANT_A), payload)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
    await app.close()
  })

  it('aborts the model call and stores nothing when the client disconnects', async () => {
    let sawAbort!: () => void
    const aborted = new Promise<void>((resolve) => (sawAbort = resolve))
    const chat: ChatProvider = {
      defaultModel: 'slow',
      async *chat(req) {
        yield { type: 'text', text: 'Thinking' }
        await new Promise<never>((_, reject) =>
          req.signal!.addEventListener('abort', () => {
            sawAbort()
            reject(req.signal!.reason)
          }),
        )
      },
    }
    const app = await buildTestApp(makeDeps(db, { chat }))
    try {
      await app.listen({ port: 0, host: '127.0.0.1' })
      const { port } = app.server.address() as AddressInfo
      const ac = new AbortController()
      const res = await fetch(`http://127.0.0.1:${port}/chat/messages`, {
        method: 'POST',
        headers: { ...customerHeaders(TENANT_A), 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Hello?' }),
        signal: ac.signal,
      })
      expect(res.status).toBe(200)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let seen = ''
      while (!seen.includes('Thinking')) {
        const { value, done } = await reader.read()
        if (done) throw new Error('stream ended before Thinking: ' + seen)
        seen += decoder.decode(value, { stream: true })
      }
      ac.abort()
      await aborted
      await new Promise((r) => setTimeout(r, 50))
      expect(await messageCount()).toBe(0)
    } finally {
      // Node 22's fetch opens a spare keep-alive connection after the abort that never sends a request, and
      // server.close() waits for it; drop it like the gateway tests do.
      app.server.closeAllConnections()
      await app.close()
    }
  })

  it('stores nothing when the client disconnects and the provider ignores the signal', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const chat: ChatProvider = {
      defaultModel: 'deaf',
      async *chat() {
        yield { type: 'text', text: 'Thinking' }
        await gate
      },
    }
    const app = await buildTestApp(makeDeps(db, { chat }))
    try {
      await app.listen({ port: 0, host: '127.0.0.1' })
      const { port } = app.server.address() as AddressInfo
      const ac = new AbortController()
      const res = await fetch(`http://127.0.0.1:${port}/chat/messages`, {
        method: 'POST',
        headers: { ...customerHeaders(TENANT_A), 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Hello?' }),
        signal: ac.signal,
      })
      expect(res.status).toBe(200)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let seen = ''
      while (!seen.includes('Thinking')) {
        const { value, done } = await reader.read()
        if (done) throw new Error('stream ended before Thinking: ' + seen)
        seen += decoder.decode(value, { stream: true })
      }
      ac.abort()
      await new Promise((r) => setTimeout(r, 100))
      release()
      await new Promise((r) => setTimeout(r, 100))
      expect(await messageCount()).toBe(0)
    } finally {
      release()
      // See the test above: Node 22's fetch leaves a spare connection open after the abort.
      app.server.closeAllConnections()
      await app.close()
    }
  })

  it('offers lookup_order only to a verified customer on a shop with order lookup', async () => {
    const cases: [Record<string, string>, object, boolean, string[]][] = [
      [customerHeaders(TENANT_A, 'cust_maya'), { message: 'Where is my order?' }, true, ['search_kb', 'lookup_order']],
      [customerHeaders(TENANT_A), { message: 'Where is my order?' }, true, ['search_kb']],
      [customerHeaders(TENANT_A), { message: 'Where is my order?', customerId: 'cust_maya' }, true, ['search_kb']],
      [customerHeaders(TENANT_A, 'cust_maya'), { message: 'Where is my order?' }, false, ['search_kb']],
    ]
    for (const [headers, payload, orderLookup, expected] of cases) {
      const chat = createScriptedChat(() => answer('ok'))
      const app = await buildTestApp(makeDeps(db, { chat, agentConfigs: fakeConfigs({}, 'Test Shop', orderLookup) }))
      await send(app, headers, payload)
      expect(chat.requests[0]!.tools!.map((t) => t.name)).toEqual(expected)
      await app.close()
    }
  })

  it('tells the model whether the shopper is signed in, without the customer id', async () => {
    const cases: [Record<string, string>, boolean, string, string[]][] = [
      [customerHeaders(TENANT_A, 'cust_maya'), true, 'The customer is signed in on Test Shop and verified.', ['is not signed in', 'has not connected']],
      [customerHeaders(TENANT_A), true, 'The customer is not signed in, so you cannot see any orders.', ['is signed in on', 'has not connected']],
      [customerHeaders(TENANT_A, 'cust_maya'), false, 'Test Shop has not connected its order system', ['is signed in on', 'is not signed in']],
    ]
    for (const [headers, orderLookup, expected, absent] of cases) {
      const chat = createScriptedChat(() => answer('ok'))
      const app = await buildTestApp(makeDeps(db, { chat, agentConfigs: fakeConfigs({}, 'Test Shop', orderLookup) }))
      await send(app, headers, { message: 'Where is my order?' })
      const system = chat.requests[0]!.messages[0]!.content
      expect(system).toContain(expected)
      for (const text of absent) expect(system).not.toContain(text)
      expect(system).not.toContain('cust_maya')
      await app.close()
    }
  })

  it("looks up the gateway's customer whatever the model passes, streams the order and stores it", async () => {
    const orders = fakeOrders({ status: 'ok', order: ORDER })
    const chat = createScriptedChat((_req, call) =>
      call === 0 ? callLookup({ orderId: '1001', customerId: 'cust_leo' }) : answer('Order 1001 has shipped.'),
    )
    const app = await buildTestApp(makeDeps(db, { chat, orders, agentConfigs: fakeConfigs({}, 'Test Shop', true) }))
    const events = await parseEvents((await send(app, customerHeaders(TENANT_A, 'cust_maya'), { message: 'Where is order 1001?' })).payload)
    expect(orders.calls).toEqual([{ kind: 'get', tenantId: TENANT_A, customerId: 'cust_maya', orderId: '1001' }])
    expect(events.find((e) => e.event === 'tool' && e.data.name === 'lookup_order')!.data).toEqual({
      name: 'lookup_order',
      status: 'ok',
      sources: [],
      orders: [{ orderId: '1001', status: 'shipped' }],
    })
    expect(chat.requests[1]!.messages.at(-1)).toEqual({ role: 'tool', toolCallId: 'c1', content: JSON.stringify({ order: ORDER }) })
    expect(events.at(-1)!.event).toBe('done')
    const stored = await listMessages(db, TENANT_A, events[0]!.data.conversationId)
    expect(stored[1]!.tools[1]).toEqual({
      name: 'lookup_order',
      arguments: { orderId: '1001', customerId: 'cust_leo' },
      status: 'ok',
      results: [],
      error: null,
      orders: [ORDER],
    })
    await app.close()
  })

  it.each([
    ['not_found', ORDER_NOT_FOUND, 'empty', null],
    ['unavailable', ORDERS_UNAVAILABLE, 'error', 'unavailable'],
    ['misconfigured', ORDERS_UNAVAILABLE, 'error', 'misconfigured'],
    ['not_configured', ORDERS_UNAVAILABLE, 'error', 'not_configured'],
  ] as const)('on %s tells the model so, stores the status and still finishes the turn', async (status, content, toolStatus, error) => {
    const chat = createScriptedChat((_req, call) => (call === 0 ? callLookup({ orderId: '1001' }) : answer("I can't check that right now.")))
    const app = await buildTestApp(makeDeps(db, { chat, orders: fakeOrders({ status }), agentConfigs: fakeConfigs({}, 'Test Shop', true) }))
    const events = await parseEvents((await send(app, customerHeaders(TENANT_A, 'cust_maya'), { message: 'Order 1001?' })).payload)
    expect(chat.requests[1]!.messages.at(-1)).toEqual({ role: 'tool', toolCallId: 'c1', content })
    expect(events.find((e) => e.event === 'tool' && e.data.name === 'lookup_order')!.data).toMatchObject({ name: 'lookup_order', status: toolStatus })
    expect(events.at(-1)!.event).toBe('done')
    const stored = await listMessages(db, TENANT_A, events[0]!.data.conversationId)
    expect(stored[1]!.tools[1]).toEqual({ name: 'lookup_order', arguments: { orderId: '1001' }, status: toolStatus, results: [], error })
    await app.close()
  })
})
