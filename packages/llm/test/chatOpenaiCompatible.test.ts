import { describe, expect, it, vi } from 'vitest'
import { createOpenAICompatibleChat } from '../src/chat/openaiCompatible'
import { ChatError, type ChatEvent, type ChatProviderConfig, type ChatRequest } from '../src/chat/types'

const CONFIG: ChatProviderConfig = {
  provider: 'openai-compatible',
  baseUrl: 'http://llm.test/v4',
  apiKey: 'sk-chat-secret',
  model: 'glm-4.5-air',
  timeoutMs: 1000,
  thinking: 'disabled',
}

const enc = new TextEncoder()
const sse = (...chunks: unknown[]) => chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join('')
const delta = (d: object, finish: string | null = null) => ({
  choices: [{ index: 0, delta: d, ...(finish ? { finish_reason: finish } : {}) }],
})

/** A streamed 200 response, cut into `pieceSize`-byte chunks. */
function streamResponse(text: string, pieceSize?: number): Response {
  const bytes = enc.encode(text)
  const size = pieceSize ?? Math.max(bytes.length, 1)
  let at = 0
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= bytes.length) return c.close()
      c.enqueue(bytes.slice(at, at + size))
      at += size
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

type Reply = (() => Response) | Error | 'hang'
const ok = (text: string, pieceSize?: number): Reply => () => streamResponse(text, pieceSize)
const status = (code: number, body = '{"error":{"code":"1211","message":"模型不存在"}}'): Reply => () => new Response(body, { status: code })

/** Answers each call with the next reply (the last one repeats). 'hang' waits until the request is aborted. */
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit; body: any }[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) })
    if (init.signal?.aborted) throw init.signal.reason
    const r = replies[calls.length - 1] ?? replies.at(-1)!
    if (r === 'hang') {
      return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))
    }
    if (r instanceof Error) throw r
    return r()
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const noSleep = async () => {}
const REQ: ChatRequest = { messages: [{ role: 'user', content: 'Hi' }] }

async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

/** Collects events until the stream fails; returns both. */
async function collectUntilError(events: AsyncIterable<ChatEvent>): Promise<{ events: ChatEvent[]; error: unknown }> {
  const out: ChatEvent[] = []
  try {
    for await (const e of events) out.push(e)
  } catch (error) {
    return { events: out, error }
  }
  return { events: out, error: null }
}

describe('openai-compatible chat', () => {
  it('posts an OpenAI-shaped streaming request with tools, thinking disabled and a bearer key', async () => {
    const { fetch, calls } = fakeFetch([ok(sse(delta({ content: 'Hi' }, 'stop'), '[DONE]'))])
    const chat = createOpenAICompatibleChat(CONFIG, fetch, noSleep)
    await collect(
      chat.chat({
        messages: [
          { role: 'system', content: 'rules' },
          { role: 'user', content: 'Returns?' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'search_kb', arguments: '{"query":"returns"}' }] },
          { role: 'tool', toolCallId: 'c1', content: '{"results":[]}' },
        ],
        tools: [{ name: 'search_kb', description: 'Search', parameters: { type: 'object' } }],
      }),
    )
    expect(calls[0]!.url).toBe('http://llm.test/v4/chat/completions')
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer sk-chat-secret')
    expect(calls[0]!.body).toEqual({
      model: 'glm-4.5-air',
      stream: true,
      thinking: { type: 'disabled' },
      tool_choice: 'auto',
      tools: [{ type: 'function', function: { name: 'search_kb', description: 'Search', parameters: { type: 'object' } } }],
      messages: [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'Returns?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_kb', arguments: '{"query":"returns"}' } }],
        },
        { role: 'tool', tool_call_id: 'c1', content: '{"results":[]}' },
      ],
    })
  })

  it('uses the request model, and sends neither tools nor thinking when not wanted', async () => {
    const { fetch, calls } = fakeFetch([ok(sse(delta({ content: 'x' }, 'stop'), '[DONE]'))])
    const chat = createOpenAICompatibleChat({ ...CONFIG, thinking: 'omit' }, fetch, noSleep)
    expect(chat.defaultModel).toBe('glm-4.5-air')
    await collect(chat.chat({ ...REQ, model: 'glm-4.6' }))
    expect(calls[0]!.body).toEqual({ model: 'glm-4.6', stream: true, messages: [{ role: 'user', content: 'Hi' }] })
  })

  it('streams text and ignores reasoning_content and empty deltas', async () => {
    const body = sse(
      delta({ role: 'assistant', reasoning_content: 'thinking…' }),
      delta({ content: '' }),
      delta({ content: 'Hello' }),
      delta({ content: ' there' }, 'stop'),
      '[DONE]',
    )
    const chat = createOpenAICompatibleChat(CONFIG, fakeFetch([ok(body)]).fetch, noSleep)
    expect(await collect(chat.chat(REQ))).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' there' },
      { type: 'done', finishReason: 'stop' },
    ])
  })

  it("emits GLM's one-chunk tool call after the preamble text", async () => {
    const body = sse(
      delta({ role: 'assistant', content: "\nI'll search." }),
      delta({
        tool_calls: [{ id: 'call_4af7', index: 0, type: 'function', function: { name: 'search_kb', arguments: '{"query":"return policy"}' } }],
      }),
      { ...delta({ role: 'assistant', content: '' }, 'tool_calls'), usage: { total_tokens: 212 } },
      '[DONE]',
    )
    const chat = createOpenAICompatibleChat(CONFIG, fakeFetch([ok(body)]).fetch, noSleep)
    expect(await collect(chat.chat(REQ))).toEqual([
      { type: 'text', text: "\nI'll search." },
      { type: 'tool_call', call: { id: 'call_4af7', name: 'search_kb', arguments: '{"query":"return policy"}' } },
      { type: 'done', finishReason: 'tool_calls' },
    ])
  })

  it('assembles OpenAI-style argument fragments for several calls, in index order', async () => {
    const body = sse(
      delta({ tool_calls: [{ index: 0, id: 'a', type: 'function', function: { name: 'search_kb', arguments: '' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] }),
      delta({ tool_calls: [{ index: 1, id: 'b', type: 'function', function: { name: 'other', arguments: '{}' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '"returns"}' } }] }),
      delta({}, 'tool_calls'),
      '[DONE]',
    )
    const chat = createOpenAICompatibleChat(CONFIG, fakeFetch([ok(body)]).fetch, noSleep)
    expect(await collect(chat.chat(REQ))).toEqual([
      { type: 'tool_call', call: { id: 'a', name: 'search_kb', arguments: '{"query":"returns"}' } },
      { type: 'tool_call', call: { id: 'b', name: 'other', arguments: '{}' } },
      { type: 'done', finishReason: 'tool_calls' },
    ])
  })

  it('handles a stream cut into small pieces, multi-byte characters included', async () => {
    const body = sse(delta({ content: 'Xin chào ' }), delta({ content: 'bạn!' }, 'stop'), '[DONE]')
    const chat = createOpenAICompatibleChat(CONFIG, fakeFetch([ok(body, 5)]).fetch, noSleep)
    const text = (await collect(chat.chat(REQ))).flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('')
    expect(text).toBe('Xin chào bạn!')
  })

  it('retries 429, 5xx and network errors before the stream starts', async () => {
    const { fetch, calls } = fakeFetch([status(429), new Error('ECONNRESET'), ok(sse(delta({ content: 'ok' }, 'stop'), '[DONE]'))])
    const sleep = vi.fn(noSleep)
    const chat = createOpenAICompatibleChat(CONFIG, fetch, sleep)
    expect(await collect(chat.chat(REQ))).toEqual([
      { type: 'text', text: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ])
    expect(calls).toHaveLength(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('gives up after three attempts with a retryable ChatError', async () => {
    const { fetch, calls } = fakeFetch([status(503)])
    const err = await collectUntilError(createOpenAICompatibleChat(CONFIG, fetch, noSleep).chat(REQ))
    expect(err.error).toBeInstanceOf(ChatError)
    expect((err.error as ChatError).retryable).toBe(true)
    expect(calls).toHaveLength(3)
  })

  it('does not retry a 400, names the provider error code, and never includes the key', async () => {
    const { fetch, calls } = fakeFetch([status(400)])
    const { error } = await collectUntilError(createOpenAICompatibleChat(CONFIG, fetch, noSleep).chat(REQ))
    expect(error).toMatchObject({ retryable: false })
    expect((error as Error).message).toBe('The chat model returned HTTP 400 (code 1211)')
    expect((error as Error).message).not.toContain('sk-chat-secret')
    expect(calls).toHaveLength(1)
  })

  it('times out a request that never answers and retries it', async () => {
    const { fetch, calls } = fakeFetch(['hang'])
    const { error } = await collectUntilError(createOpenAICompatibleChat({ ...CONFIG, timeoutMs: 20 }, fetch, noSleep).chat(REQ))
    expect(error).toBeInstanceOf(ChatError)
    expect((error as Error).message).toBe('The chat model did not respond')
    expect(calls).toHaveLength(3)
  })

  it('fails with a retryable ChatError when the stream ends without finishing', async () => {
    const chat = createOpenAICompatibleChat(CONFIG, fakeFetch([ok(sse(delta({ content: 'Hal' })))]).fetch, noSleep)
    const { events, error } = await collectUntilError(chat.chat(REQ))
    expect(events).toEqual([{ type: 'text', text: 'Hal' }])
    expect(error).toBeInstanceOf(ChatError)
    expect((error as ChatError).retryable).toBe(true)
  })

  it('turns an error chunk into a non-retryable ChatError', async () => {
    const chat = createOpenAICompatibleChat(CONFIG, fakeFetch([ok(sse({ error: { code: '1301', message: 'unsafe' } }))]).fetch, noSleep)
    const { error } = await collectUntilError(chat.chat(REQ))
    expect(error).toMatchObject({ retryable: false, message: 'The chat model reported an error (code 1301)' })
  })

  it("rethrows the caller's abort reason without retrying", async () => {
    const { fetch, calls } = fakeFetch([ok(sse(delta({ content: 'x' }, 'stop'), '[DONE]'))])
    const ac = new AbortController()
    ac.abort(new Error('client left'))
    const { error } = await collectUntilError(createOpenAICompatibleChat(CONFIG, fetch, noSleep).chat({ ...REQ, signal: ac.signal }))
    expect((error as Error).message).toBe('client left')
    expect(calls).toHaveLength(1)
  })
})
