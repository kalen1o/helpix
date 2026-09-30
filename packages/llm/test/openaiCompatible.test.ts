import { describe, expect, it, vi } from 'vitest'
import { createOpenAICompatibleEmbeddings } from '../src/openaiCompatible'
import { EmbeddingError, type EmbeddingConfig } from '../src/types'

const CONFIG: EmbeddingConfig = {
  provider: 'openai-compatible',
  baseUrl: 'http://llm.test/v4',
  apiKey: 'sk-secret-key',
  model: 'embedding-3',
  dimensions: 4,
  batchMaxItems: 64,
  batchMaxTokens: 3000,
  timeoutMs: 1000,
}

const vec = (n: number) => [n, 0, 0, 0]

/** Replies to each call with the given status, or 200 with one vector per input (in reverse index order). */
function fakeFetch(statuses: number[] = []) {
  const calls: { url: string; init: RequestInit; body: any }[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body))
    calls.push({ url: String(url), init, body })
    const status = statuses[calls.length - 1] ?? 200
    if (status !== 200) return new Response('{"error":"nope"}', { status })
    const data = (body.input as string[]).map((_, i) => ({ index: i, object: 'embedding', embedding: vec(i) })).reverse()
    return Response.json({ model: body.model, object: 'list', data })
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const noSleep = async () => {}

describe('openai-compatible embeddings', () => {
  it('posts model, input and dimensions with a bearer key and returns vectors in input order', async () => {
    const { fetch, calls } = fakeFetch()
    const p = createOpenAICompatibleEmbeddings(CONFIG, fetch, noSleep)
    expect(p.modelId).toBe('openai-compatible:embedding-3:4')
    expect(await p.embed(['a', 'b', 'c'])).toEqual([vec(0), vec(1), vec(2)])
    expect(calls[0]!.url).toBe('http://llm.test/v4/embeddings')
    expect(calls[0]!.body).toEqual({ model: 'embedding-3', input: ['a', 'b', 'c'], dimensions: 4 })
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer sk-secret-key')
  })

  it('splits into batches of at most batchMaxItems', async () => {
    const { fetch, calls } = fakeFetch()
    const p = createOpenAICompatibleEmbeddings({ ...CONFIG, batchMaxItems: 64 }, fetch, noSleep)
    const out = await p.embed(Array.from({ length: 70 }, (_, i) => `t${i}`))
    expect(out).toHaveLength(70)
    expect(calls.map((c) => c.body.input.length)).toEqual([64, 6])
  })

  it('retries 429 and 5xx, then succeeds', async () => {
    const { fetch, calls } = fakeFetch([429, 503])
    const sleep = vi.fn(noSleep)
    const p = createOpenAICompatibleEmbeddings(CONFIG, fetch, sleep)
    expect(await p.embed(['a'])).toEqual([vec(0)])
    expect(calls).toHaveLength(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('gives up after three attempts with a retryable EmbeddingError', async () => {
    const { fetch, calls } = fakeFetch([500, 500, 500])
    const p = createOpenAICompatibleEmbeddings(CONFIG, fetch, noSleep)
    const err = await p.embed(['a']).catch((e) => e)
    expect(err).toBeInstanceOf(EmbeddingError)
    expect(err.retryable).toBe(true)
    expect(calls).toHaveLength(3)
  })

  it('does not retry a 400 and never puts the API key in the error', async () => {
    const { fetch, calls } = fakeFetch([400])
    const p = createOpenAICompatibleEmbeddings(CONFIG, fetch, noSleep)
    const err = await p.embed(['a']).catch((e) => e)
    expect(err).toMatchObject({ retryable: false })
    expect(err.message).toContain('400')
    expect(err.message).not.toContain('sk-secret-key')
    expect(calls).toHaveLength(1)
  })

  it('treats a network failure as retryable', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof globalThis.fetch
    const err = await createOpenAICompatibleEmbeddings(CONFIG, fetch, noSleep).embed(['a']).catch((e) => e)
    expect(err).toMatchObject({ name: 'EmbeddingError', retryable: true })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('rejects vectors of the wrong dimension or count', async () => {
    const wrongDims = vi.fn(async () => Response.json({ data: [{ index: 0, embedding: [1, 2] }] })) as unknown as typeof globalThis.fetch
    await expect(createOpenAICompatibleEmbeddings(CONFIG, wrongDims, noSleep).embed(['a'])).rejects.toThrow('not 4-dimensional')
    const wrongCount = vi.fn(async () => Response.json({ data: [] })) as unknown as typeof globalThis.fetch
    await expect(createOpenAICompatibleEmbeddings(CONFIG, wrongCount, noSleep).embed(['a'])).rejects.toThrow('unexpected response')
  })

  it('makes no request for no texts', async () => {
    const { fetch, calls } = fakeFetch()
    expect(await createOpenAICompatibleEmbeddings(CONFIG, fetch, noSleep).embed([])).toEqual([])
    expect(calls).toHaveLength(0)
  })
})
