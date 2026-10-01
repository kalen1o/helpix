import type { AddressInfo } from 'node:net'
import { ChatError, createScriptedChat, type ChatEvent, type ChatProvider } from '@helpix/llm'
import { AppError, type Db } from '@helpix/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { listMessages } from '../src/repos/messages'
import {
  adminHeaders,
  buildTestApp,
  customerHeaders,
  fakeConfigs,
  fakeKb,
  HIT,
  internalHeaders,
  makeDeps,
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

  it('continues the conversation with its session token and sends the history to the model', async () => {
    const chat = createScriptedChat((_req, call) => answer(`Answer ${call}`))
    const app = await buildTestApp(makeDeps(db, { chat }))
    const first = await parseEvents((await send(app, customerHeaders(TENANT_A), { message: 'First?' })).payload)
    const { conversationId, sessionToken } = first[0]!.data
    const second = await parseEvents((await send(app, customerHeaders(TENANT_A), { message: 'Second?', conversationId, sessionToken })).payload)
    expect(second[0]).toEqual({ event: 'meta', data: { conversationId } })
    expect(replyText(second)).toBe('Answer 1')
    expect(chat.requests[1]!.messages.slice(1)).toEqual([
      { role: 'user', content: 'First?' },
      { role: 'assistant', content: 'Answer 0' },
      { role: 'user', content: 'Second?' },
    ])
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
    expect(events.map((e) => e.event)).toEqual(['meta', 'delta', 'error'])
    expect(events[2]!.data).toEqual({ code: 'llm_unavailable', message: 'The assistant is unavailable right now. Please try again.' })
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
      await app.close()
    }
  })
})
