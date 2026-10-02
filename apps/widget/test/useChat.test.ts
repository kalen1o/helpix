import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WidgetApi } from '../src/api'
import { createIdentity, setToken, type Identity } from '../src/identity'
import { loadHistory, loadSession, saveHistory, saveSession } from '../src/storage'
import { useChat } from '../src/useChat'
import { errorResponse, fakeApi, fakeJwt, sseResponse } from './helpers'

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

const KEY = 'wk_1'
const reply = (text: string, extra: object = {}) =>
  sseResponse([
    { event: 'meta', data: { conversationId: 'c1', sessionToken: 's1', ...extra } },
    { event: 'tool', data: { name: 'search_kb', status: 'ok', sources: [{ documentId: 'd1', title: 'Returns' }] } },
    { event: 'delta', data: { text: text.slice(0, 3) } },
    { event: 'delta', data: { text: text.slice(3) } },
    { event: 'done', data: { messageId: 'm1' } },
  ])

function signedIn(sub: string): Identity {
  const identity = createIdentity()
  setToken(identity, fakeJwt({ sub }))
  return identity
}

const chatFor = (api: WidgetApi, identity: Identity = createIdentity()) => useChat({ api, widgetKey: KEY, identity })

/** A sendMessage that never answers and rejects when aborted, like fetch. */
function hangingApi() {
  const signals: AbortSignal[] = []
  const api: WidgetApi = {
    fetchConfig: async () => { throw new Error('unused') },
    sendMessage: (_b, s) => {
      signals.push(s)
      return new Promise<Response>((_r, reject) => s.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    },
  }
  return { api, signals }
}

describe('useChat', () => {
  it('streams a reply and remembers the conversation', async () => {
    const { api, bodies } = fakeApi([reply('Hello there')])
    const chat = chatFor(api)
    await chat.send('  Hi  ')
    expect(bodies[0]).toEqual({ message: 'Hi' })
    expect(chat.messages.value.map((m) => [m.role, m.content, m.status])).toEqual([
      ['user', 'Hi', 'done'],
      ['assistant', 'Hello there', 'done'],
    ])
    expect(chat.messages.value[1]!.tools[0]!.sources[0]!.title).toBe('Returns')
    expect(loadSession(KEY)).toEqual({ conversationId: 'c1', sessionToken: 's1', customerId: null })
    expect(loadHistory(KEY, null)).toHaveLength(2)
    expect(chat.busy.value).toBe(false)
  })

  it('sends the stored conversation and session token, keeping the token when meta omits it', async () => {
    saveSession(KEY, { conversationId: 'c1', sessionToken: 's1', customerId: null })
    const { api, bodies } = fakeApi([sseResponse([{ event: 'meta', data: { conversationId: 'c1' } }, { event: 'done', data: { messageId: 'm2' } }])])
    await chatFor(api).send('Again')
    expect(bodies[0]).toEqual({ message: 'Again', conversationId: 'c1', sessionToken: 's1' })
    expect(loadSession(KEY)).toEqual({ conversationId: 'c1', sessionToken: 's1', customerId: null })
  })

  it('starts a new conversation when the stored one is gone', async () => {
    saveSession(KEY, { conversationId: 'stale', sessionToken: 'old', customerId: null })
    const { api, bodies } = fakeApi([errorResponse(404, 'conversation_not_found'), reply('Fresh start')])
    const chat = chatFor(api)
    await chat.send('Hi')
    expect(bodies).toEqual([{ message: 'Hi', conversationId: 'stale', sessionToken: 'old' }, { message: 'Hi' }])
    expect(chat.messages.value.at(-1)!.content).toBe('Fresh start')
    expect(loadSession(KEY)?.conversationId).toBe('c1')
  })

  it('retries a stale conversation only once', async () => {
    saveSession(KEY, { conversationId: 'stale', sessionToken: 'old', customerId: null })
    const { api, bodies } = fakeApi([errorResponse(404, 'conversation_not_found'), errorResponse(404, 'conversation_not_found')])
    const chat = chatFor(api)
    await chat.send('Hi')
    expect(bodies).toHaveLength(2)
    expect(chat.messages.value.at(-1)!.status).toBe('error')
  })

  it('shows a stream error and "Try again" resends the same message', async () => {
    const { api, bodies } = fakeApi([
      sseResponse([{ event: 'meta', data: { conversationId: 'c1', sessionToken: 's1' } }, { event: 'error', data: { code: 'model_unavailable', message: 'The assistant is busy. Try again.' } }]),
      reply('Second time lucky'),
    ])
    const chat = chatFor(api)
    await chat.send('Hi')
    const failed = chat.messages.value.at(-1)!
    expect(failed).toMatchObject({ role: 'assistant', status: 'error', error: 'The assistant is busy. Try again.' })
    await chat.retry()
    expect(bodies[1]).toEqual({ message: 'Hi', conversationId: 'c1', sessionToken: 's1' })
    expect(chat.messages.value.map((m) => m.content)).toEqual(['Hi', 'Second time lucky'])
  })

  it('treats a stream that ends without done as an error', async () => {
    const { api } = fakeApi([sseResponse([{ event: 'meta', data: { conversationId: 'c1' } }, { event: 'delta', data: { text: 'Half' } }])])
    const chat = chatFor(api)
    await chat.send('Hi')
    expect(chat.messages.value.at(-1)).toMatchObject({ status: 'error', content: 'Half' })
  })

  it('reports HTTP errors and network failures without throwing', async () => {
    const { api } = fakeApi([errorResponse(403, 'tenant_suspended', "This shop's account is suspended"), () => Promise.reject(new TypeError('Failed to fetch'))])
    const chat = chatFor(api)
    await chat.send('One')
    expect(chat.messages.value.at(-1)!.error).toBe("This shop's account is suspended")
    await chat.send('Two')
    expect(chat.messages.value.at(-1)!.error).toBe("Couldn't reach the shop's assistant. Check your connection and try again.")
  })

  it('ignores blank messages and messages sent while a reply is streaming', async () => {
    let release!: (r: Response) => void
    const { api, bodies } = fakeApi([() => new Promise<Response>((r) => (release = r))])
    const chat = chatFor(api)
    await chat.send('   ')
    const first = chat.send('Hi')
    await chat.send('Too soon')
    release(reply('ok'))
    await first
    expect(bodies).toHaveLength(1)
  })

  it('newChat aborts the reply in progress and forgets the conversation', async () => {
    saveSession(KEY, { conversationId: 'c1', sessionToken: 's1', customerId: null })
    const { api, signals } = hangingApi()
    const chat = chatFor(api)
    const pending = chat.send('Hi')
    chat.newChat()
    await pending
    expect(signals[0]!.aborted).toBe(true)
    expect(chat.messages.value).toEqual([])
    expect(loadSession(KEY)).toBeNull()
    expect(chat.busy.value).toBe(false)
  })

  it('newChat after deltas have streamed ignores every later event', async () => {
    const enc = new TextEncoder()
    const sse = (event: string, data: object) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start: (c) => { stream = c } })
    const api: WidgetApi = {
      fetchConfig: async () => { throw new Error('unused') },
      sendMessage: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    }
    const chat = chatFor(api)
    const pending = chat.send('Hi')
    stream.enqueue(sse('meta', { conversationId: 'c1', sessionToken: 's1' }))
    stream.enqueue(sse('delta', { text: 'Hel' }))
    await new Promise((r) => setTimeout(r, 20))
    expect(chat.messages.value.at(-1)?.content).toBe('Hel')
    chat.newChat()
    stream.enqueue(sse('meta', { conversationId: 'c2', sessionToken: 's2' }))
    stream.enqueue(sse('delta', { text: 'lo' }))
    stream.close()
    await expect(pending).resolves.toBeUndefined()
    expect(chat.messages.value).toEqual([])
    expect(loadSession(KEY)).toBeNull()
    expect(chat.busy.value).toBe(false)
  })

  it('restores finished messages from this tab', () => {
    sessionStorage.setItem('helpix:wk_1', JSON.stringify([{ role: 'user', content: 'Earlier', tools: [] }]))
    const chat = chatFor(fakeApi([]).api)
    expect(chat.messages.value.map((m) => m.content)).toEqual(['Earlier'])
  })
})

describe('useChat shopper identity', () => {
  it('a returning shopper identified after a guest mount gets their conversation back', async () => {
    saveSession(KEY, { conversationId: 'c1', sessionToken: 's1', customerId: 'cust_maya' })
    saveHistory(KEY, { customerId: 'cust_maya', messages: [{ role: 'user', content: 'Maya asked', tools: [] }] })
    const identity = createIdentity()
    const { api, bodies } = fakeApi([reply('Again')], undefined, () => identity.token)
    const chat = chatFor(api, identity)
    expect(chat.messages.value).toEqual([])
    expect(loadSession(KEY)).toEqual({ conversationId: 'c1', sessionToken: 's1', customerId: 'cust_maya' })
    expect(loadHistory(KEY, 'cust_maya')).toHaveLength(1)

    setToken(identity, fakeJwt({ sub: 'cust_maya' }))
    expect(chat.messages.value.map((m) => m.content)).toEqual(['Maya asked'])
    await chat.send('More')
    expect(bodies[0]).toEqual({ message: 'More', conversationId: 'c1', sessionToken: 's1' })
  })

  it("switching shoppers removes the previous shopper's entries and never shows them to the next", async () => {
    saveSession(KEY, { conversationId: 'c1', sessionToken: 's1', customerId: 'cust_maya' })
    saveHistory(KEY, { customerId: 'cust_maya', messages: [{ role: 'user', content: 'Maya asked', tools: [] }] })
    const identity = signedIn('cust_maya')
    const { api, bodies } = fakeApi([reply('Hi Leo', { conversationId: 'c2' })], undefined, () => identity.token)
    const chat = chatFor(api, identity)
    expect(chat.messages.value).toHaveLength(1)
    setToken(identity, fakeJwt({ sub: 'cust_leo' }))
    expect(chat.messages.value).toEqual([])
    expect(loadSession(KEY)).toBeNull()
    expect(sessionStorage.getItem('helpix:wk_1')).toBeNull()
    await chat.send('Hello')
    expect(bodies[0]).toEqual({ message: 'Hello' })
  })

  it('a switch never deletes a conversation stored for a third customer', () => {
    saveSession(KEY, { conversationId: 'c7', sessionToken: 's7', customerId: 'cust_zed' })
    saveHistory(KEY, { customerId: 'cust_zed', messages: [{ role: 'user', content: 'Zed asked', tools: [] }] })
    const identity = signedIn('cust_maya')
    const chat = chatFor(fakeApi([]).api, identity)
    setToken(identity, fakeJwt({ sub: 'cust_leo' }))
    setToken(identity, null)
    expect(chat.messages.value).toEqual([])
    expect(loadSession(KEY)).toEqual({ conversationId: 'c7', sessionToken: 's7', customerId: 'cust_zed' })
    expect(loadHistory(KEY, 'cust_zed')).toHaveLength(1)
  })

  it('saves the signed-in customer with the conversation', async () => {
    const identity = signedIn('cust_maya')
    const { api, tokens } = fakeApi([reply('Your order shipped')], undefined, () => identity.token)
    await chatFor(api, identity).send('Where is my order?')
    expect(tokens).toEqual([identity.token])
    expect(loadSession(KEY)).toEqual({ conversationId: 'c1', sessionToken: 's1', customerId: 'cust_maya' })
  })

  it('identify with a different customer clears the conversation', async () => {
    const identity = signedIn('cust_maya')
    const { api, bodies } = fakeApi([reply('Your order shipped'), reply('Hi Leo', { conversationId: 'c2' })], undefined, () => identity.token)
    const chat = chatFor(api, identity)
    await chat.send('Where is my order?')
    expect(chat.messages.value).toHaveLength(2)

    setToken(identity, fakeJwt({ sub: 'cust_leo' }))
    expect(chat.messages.value).toEqual([])
    expect(loadSession(KEY)).toBeNull()
    expect(loadHistory(KEY, 'cust_leo')).toEqual([])
    expect(sessionStorage.getItem('helpix:wk_1')).toBeNull()

    await chat.send('Hello')
    expect(bodies[1]).toEqual({ message: 'Hello' })
    expect(loadSession(KEY)).toEqual({ conversationId: 'c2', sessionToken: 's1', customerId: 'cust_leo' })
  })

  it('identify with a different customer aborts the reply in progress', async () => {
    const identity = signedIn('cust_maya')
    const { api, signals } = hangingApi()
    const chat = chatFor(api, identity)
    const pending = chat.send('Where is my order?')
    setToken(identity, fakeJwt({ sub: 'cust_leo' }))
    await pending
    expect(signals[0]!.aborted).toBe(true)
    expect(chat.messages.value).toEqual([])
    expect(chat.busy.value).toBe(false)
  })

  it("refreshing the same customer's token keeps the conversation and sends the new token", async () => {
    const identity = signedIn('cust_maya')
    const { api, bodies, tokens } = fakeApi([reply('One'), reply('Two')], undefined, () => identity.token)
    const chat = chatFor(api, identity)
    await chat.send('First')
    const fresh = fakeJwt({ sub: 'cust_maya', exp: 2_000_000_000 })
    setToken(identity, fresh)
    expect(chat.messages.value).toHaveLength(2)
    await chat.send('Second')
    expect(bodies[1]).toEqual({ message: 'Second', conversationId: 'c1', sessionToken: 's1' })
    expect(tokens[1]).toBe(fresh)
  })

  it('logout clears it', async () => {
    const identity = signedIn('cust_maya')
    const { api, bodies, tokens } = fakeApi([reply('Your order shipped'), reply('Hello guest', { conversationId: 'c2' })], undefined, () => identity.token)
    const chat = chatFor(api, identity)
    await chat.send('Where is my order?')
    setToken(identity, null)
    expect(chat.messages.value).toEqual([])
    expect(loadSession(KEY)).toBeNull()
    await chat.send('Hi')
    expect(bodies[1]).toEqual({ message: 'Hi' })
    expect(tokens[1]).toBeNull()
    expect(loadSession(KEY)?.customerId).toBeNull()
  })

  it("does not show another customer's transcript, and leaves their stored session for the other tab", () => {
    saveSession(KEY, { conversationId: 'c1', sessionToken: 's1', customerId: 'cust_leo' })
    saveHistory(KEY, { customerId: 'cust_leo', messages: [{ role: 'user', content: 'Leo asked about order 1003', tools: [] }] })
    const chat = chatFor(fakeApi([]).api, signedIn('cust_maya'))
    expect(chat.messages.value).toEqual([])
    expect(loadSession(KEY)).toEqual({ conversationId: 'c1', sessionToken: 's1', customerId: 'cust_leo' })
    expect(loadHistory(KEY, 'cust_leo')).toHaveLength(1)
  })

  it("does not show a signed-in shopper's stored conversation to a guest", () => {
    saveSession(KEY, { conversationId: 'c1', sessionToken: 's1', customerId: 'cust_maya' })
    saveHistory(KEY, { customerId: 'cust_maya', messages: [{ role: 'user', content: 'Maya asked', tools: [] }] })
    const chat = chatFor(fakeApi([]).api)
    expect(chat.messages.value).toEqual([])
    expect(loadSession(KEY)).toEqual({ conversationId: 'c1', sessionToken: 's1', customerId: 'cust_maya' })
  })

  it("never shows a transcript to another shopper even when no session is stored (signed out in another tab)", () => {
    saveHistory(KEY, { customerId: 'cust_maya', messages: [{ role: 'user', content: 'Maya asked about order 1047', tools: [] }] })
    const chat = chatFor(fakeApi([]).api, signedIn('cust_leo'))
    expect(chat.messages.value).toEqual([])
    expect(loadHistory(KEY, 'cust_maya')).toHaveLength(1)
  })

  it('restores the transcript for the same owner without a stored session', () => {
    saveHistory(KEY, { customerId: 'cust_maya', messages: [{ role: 'user', content: 'Maya asked', tools: [] }] })
    const chat = chatFor(fakeApi([]).api, signedIn('cust_maya'))
    expect(chat.messages.value.map((m) => m.content)).toEqual(['Maya asked'])
  })

  it('treats an unstamped transcript as a guest transcript', () => {
    sessionStorage.setItem('helpix:wk_1', JSON.stringify([{ role: 'user', content: 'Old guest chat', tools: [] }]))
    expect(chatFor(fakeApi([]).api, signedIn('cust_maya')).messages.value).toEqual([])
    sessionStorage.setItem('helpix:wk_1', JSON.stringify([{ role: 'user', content: 'Old guest chat', tools: [] }]))
    expect(chatFor(fakeApi([]).api).messages.value.map((m) => m.content)).toEqual(['Old guest chat'])
  })

  it('keeps the stored conversation for the same customer', async () => {
    saveSession(KEY, { conversationId: 'c1', sessionToken: 's1', customerId: 'cust_maya' })
    saveHistory(KEY, { customerId: 'cust_maya', messages: [{ role: 'user', content: 'Maya asked', tools: [] }] })
    const identity = signedIn('cust_maya')
    const { api, bodies } = fakeApi([reply('Again')], undefined, () => identity.token)
    const chat = chatFor(api, identity)
    expect(chat.messages.value.map((m) => m.content)).toEqual(['Maya asked'])
    await chat.send('More')
    expect(bodies[0]).toEqual({ message: 'More', conversationId: 'c1', sessionToken: 's1' })
  })

  it('continues a session stored before shopper sign-in existed as a guest', async () => {
    localStorage.setItem('helpix:wk_1', '{"conversationId":"c1","sessionToken":"s1"}')
    const { api, bodies } = fakeApi([reply('Hi')])
    await chatFor(api).send('Hello')
    expect(bodies[0]).toEqual({ message: 'Hello', conversationId: 'c1', sessionToken: 's1' })
  })

  it('never continues a conversation another tab stored for someone else', async () => {
    const identity = signedIn('cust_maya')
    const { api, bodies } = fakeApi([reply('Hi Maya', { conversationId: 'c9' })], undefined, () => identity.token)
    const chat = chatFor(api, identity)
    saveSession(KEY, { conversationId: 'c1', sessionToken: 's1', customerId: 'cust_leo' })
    await chat.send('Hello')
    expect(bodies[0]).toEqual({ message: 'Hello' })
    expect(loadSession(KEY)).toEqual({ conversationId: 'c9', sessionToken: 's1', customerId: 'cust_maya' })
  })

  it('a rejected shop token falls back to a new guest conversation once, keeping the message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    saveSession(KEY, { conversationId: 'c1', sessionToken: 's1', customerId: 'cust_maya' })
    saveHistory(KEY, { customerId: 'cust_maya', messages: [{ role: 'user', content: 'Earlier, signed in', tools: [] }] })
    const identity = signedIn('cust_maya')
    const jwt = identity.token
    const { api, bodies, tokens } = fakeApi(
      [errorResponse(401, 'invalid_customer_token', 'Customer token is invalid'), reply('Hi there, guest', { conversationId: 'c2', sessionToken: 's2' })],
      undefined,
      () => identity.token,
    )
    const chat = chatFor(api, identity)
    await chat.send('Where is my order?')

    expect(bodies).toEqual([{ message: 'Where is my order?', conversationId: 'c1', sessionToken: 's1' }, { message: 'Where is my order?' }])
    expect(tokens).toEqual([jwt, null])
    expect(identity).toEqual({ token: null, customerId: null })
    expect(chat.messages.value.map((m) => [m.role, m.content, m.status])).toEqual([
      ['user', 'Where is my order?', 'done'],
      ['assistant', 'Hi there, guest', 'done'],
    ])
    expect(loadSession(KEY)).toEqual({ conversationId: 'c2', sessionToken: 's2', customerId: null })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('[helpix]')
    expect(chat.busy.value).toBe(false)
  })

  it('falls back to a guest only once per message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const identity = signedIn('cust_maya')
    const { api, bodies } = fakeApi(
      [errorResponse(401, 'invalid_customer_token', 'Customer token is invalid'), errorResponse(401, 'invalid_customer_token', 'Customer token is invalid')],
      undefined,
      () => identity.token,
    )
    const chat = chatFor(api, identity)
    await chat.send('Hi')
    expect(bodies).toHaveLength(2)
    expect(chat.messages.value.at(-1)).toMatchObject({ status: 'error', error: 'Customer token is invalid' })
    expect(chat.messages.value.at(-2)).toMatchObject({ role: 'user', content: 'Hi' })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('retries once with the refreshed token instead of downgrading when the storefront replaced it meanwhile', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const identity = signedIn('cust_maya')
    const old = identity.token
    const fresh = fakeJwt({ sub: 'cust_maya', exp: 2_000_000_000 })
    const { api, bodies, tokens } = fakeApi(
      [
        () => {
          setToken(identity, fresh)
          return Promise.resolve(errorResponse(401, 'invalid_customer_token', 'Customer token is invalid'))
        },
        reply('Hi again'),
      ],
      undefined,
      () => identity.token,
    )
    const chat = chatFor(api, identity)
    await chat.send('Where is my order?')
    expect(bodies).toHaveLength(2)
    expect(tokens).toEqual([old, fresh])
    expect(old).not.toBe(fresh)
    expect(identity).toEqual({ token: fresh, customerId: 'cust_maya' })
    expect(chat.messages.value.map((m) => [m.role, m.content, m.status])).toEqual([
      ['user', 'Where is my order?', 'done'],
      ['assistant', 'Hi again', 'done'],
    ])
    expect(loadSession(KEY)?.customerId).toBe('cust_maya')
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not retry more than once when the refreshed token is rejected too', async () => {
    const identity = signedIn('cust_maya')
    const fresh = fakeJwt({ sub: 'cust_maya', exp: 2_000_000_000 })
    const { api, bodies } = fakeApi(
      [
        () => {
          setToken(identity, fresh)
          return Promise.resolve(errorResponse(401, 'invalid_customer_token', 'Customer token is invalid'))
        },
        errorResponse(401, 'invalid_customer_token', 'Customer token is invalid'),
      ],
      undefined,
      () => identity.token,
    )
    const chat = chatFor(api, identity)
    await chat.send('Hi')
    expect(bodies).toHaveLength(2)
    expect(chat.messages.value.at(-1)).toMatchObject({ status: 'error' })
    expect(identity.token).toBe(fresh)
  })

  it('shows a 401 to a guest instead of retrying', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { api, bodies } = fakeApi([errorResponse(401, 'invalid_customer_token', 'Customer token is invalid')])
    const chat = chatFor(api)
    await chat.send('Hi')
    expect(bodies).toHaveLength(1)
    expect(chat.messages.value.at(-1)!.status).toBe('error')
    expect(warn).not.toHaveBeenCalled()
  })
})
