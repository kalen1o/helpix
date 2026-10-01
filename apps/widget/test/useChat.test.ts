import { afterEach, describe, expect, it } from 'vitest'
import { loadHistory, loadSession, saveSession } from '../src/storage'
import { useChat } from '../src/useChat'
import { errorResponse, fakeApi, sseResponse } from './helpers'

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
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

describe('useChat', () => {
  it('streams a reply and remembers the conversation', async () => {
    const { api, bodies } = fakeApi([reply('Hello there')])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('  Hi  ')
    expect(bodies[0]).toEqual({ message: 'Hi' })
    expect(chat.messages.value.map((m) => [m.role, m.content, m.status])).toEqual([
      ['user', 'Hi', 'done'],
      ['assistant', 'Hello there', 'done'],
    ])
    expect(chat.messages.value[1]!.tools[0]!.sources[0]!.title).toBe('Returns')
    expect(loadSession(KEY)).toEqual({ conversationId: 'c1', sessionToken: 's1' })
    expect(loadHistory(KEY)).toHaveLength(2)
    expect(chat.busy.value).toBe(false)
  })

  it('sends the stored conversation and session token, keeping the token when meta omits it', async () => {
    saveSession(KEY, { conversationId: 'c1', sessionToken: 's1' })
    const { api, bodies } = fakeApi([sseResponse([{ event: 'meta', data: { conversationId: 'c1' } }, { event: 'done', data: { messageId: 'm2' } }])])
    await useChat({ api, widgetKey: KEY }).send('Again')
    expect(bodies[0]).toEqual({ message: 'Again', conversationId: 'c1', sessionToken: 's1' })
    expect(loadSession(KEY)).toEqual({ conversationId: 'c1', sessionToken: 's1' })
  })

  it('starts a new conversation when the stored one is gone', async () => {
    saveSession(KEY, { conversationId: 'stale', sessionToken: 'old' })
    const { api, bodies } = fakeApi([errorResponse(404, 'conversation_not_found'), reply('Fresh start')])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('Hi')
    expect(bodies).toEqual([{ message: 'Hi', conversationId: 'stale', sessionToken: 'old' }, { message: 'Hi' }])
    expect(chat.messages.value.at(-1)!.content).toBe('Fresh start')
    expect(loadSession(KEY)?.conversationId).toBe('c1')
  })

  it('retries a stale conversation only once', async () => {
    saveSession(KEY, { conversationId: 'stale', sessionToken: 'old' })
    const { api, bodies } = fakeApi([errorResponse(404, 'conversation_not_found'), errorResponse(404, 'conversation_not_found')])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('Hi')
    expect(bodies).toHaveLength(2)
    expect(chat.messages.value.at(-1)!.status).toBe('error')
  })

  it('shows a stream error and "Try again" resends the same message', async () => {
    const { api, bodies } = fakeApi([
      sseResponse([{ event: 'meta', data: { conversationId: 'c1', sessionToken: 's1' } }, { event: 'error', data: { code: 'model_unavailable', message: 'The assistant is busy. Try again.' } }]),
      reply('Second time lucky'),
    ])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('Hi')
    const failed = chat.messages.value.at(-1)!
    expect(failed).toMatchObject({ role: 'assistant', status: 'error', error: 'The assistant is busy. Try again.' })
    await chat.retry()
    expect(bodies[1]).toEqual({ message: 'Hi', conversationId: 'c1', sessionToken: 's1' })
    expect(chat.messages.value.map((m) => m.content)).toEqual(['Hi', 'Second time lucky'])
  })

  it('treats a stream that ends without done as an error', async () => {
    const { api } = fakeApi([sseResponse([{ event: 'meta', data: { conversationId: 'c1' } }, { event: 'delta', data: { text: 'Half' } }])])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('Hi')
    expect(chat.messages.value.at(-1)).toMatchObject({ status: 'error', content: 'Half' })
  })

  it('reports HTTP errors and network failures without throwing', async () => {
    const { api } = fakeApi([errorResponse(403, 'tenant_suspended', "This shop's account is suspended"), () => Promise.reject(new TypeError('Failed to fetch'))])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('One')
    expect(chat.messages.value.at(-1)!.error).toBe("This shop's account is suspended")
    await chat.send('Two')
    expect(chat.messages.value.at(-1)!.error).toBe("Couldn't reach the shop's assistant. Check your connection and try again.")
  })

  it('ignores blank messages and messages sent while a reply is streaming', async () => {
    let release!: (r: Response) => void
    const { api, bodies } = fakeApi([() => new Promise<Response>((r) => (release = r))])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('   ')
    const first = chat.send('Hi')
    await chat.send('Too soon')
    release(reply('ok'))
    await first
    expect(bodies).toHaveLength(1)
  })

  it('newChat aborts the reply in progress and forgets the conversation', async () => {
    saveSession(KEY, { conversationId: 'c1', sessionToken: 's1' })
    let signal!: AbortSignal
    const api = {
      fetchConfig: async () => { throw new Error('unused') },
      sendMessage: (_b: unknown, s: AbortSignal) => {
        signal = s
        return new Promise<Response>((_r, reject) => s.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      },
    }
    const chat = useChat({ api, widgetKey: KEY })
    const pending = chat.send('Hi')
    chat.newChat()
    await pending
    expect(signal.aborted).toBe(true)
    expect(chat.messages.value).toEqual([])
    expect(loadSession(KEY)).toBeNull()
    expect(chat.busy.value).toBe(false)
  })

  it('newChat after deltas have streamed ignores every later event', async () => {
    const enc = new TextEncoder()
    const sse = (event: string, data: object) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start: (c) => { stream = c } })
    const api = {
      fetchConfig: async () => { throw new Error('unused') },
      sendMessage: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    }
    const chat = useChat({ api, widgetKey: KEY })
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
    const chat = useChat({ api: fakeApi([]).api, widgetKey: KEY })
    expect(chat.messages.value.map((m) => m.content)).toEqual(['Earlier'])
  })
})
