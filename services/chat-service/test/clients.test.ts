import { AppError, DEFAULT_AGENT_CONFIG } from '@helpix/shared'
import { describe, expect, it, vi } from 'vitest'
import { createAgentConfigClient } from '../src/clients/agentConfig'
import { createKbClient, KbUnavailableError } from '../src/clients/kb'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function fakeFetch(reply: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return reply(String(url), init)
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const hit = { documentId: 'd1', title: 'Returns', position: 0, text: 'Within 30 days.', score: 0.8 }

describe('createKbClient', () => {
  it('searches with the given tenant, the internal token and the request id', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { results: [hit] }))
    const kb = createKbClient({ baseUrl: 'http://kb.test', internalToken: 'tok', timeoutMs: 1000, fetch })
    expect(await kb.search('tenant-a', 'refunds', 'req-1')).toEqual([hit])
    expect(calls[0]!.url).toBe('http://kb.test/kb/search')
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get('x-tenant-id')).toBe('tenant-a')
    expect(headers.get('x-internal-token')).toBe('tok')
    expect(headers.get('x-request-id')).toBe('req-1')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ query: 'refunds' })
  })

  it.each([
    ['an error status', () => json(503, { error: { code: 'embedding_unavailable' } })],
    ['an unexpected body', () => json(200, { nope: true })],
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
  ])('turns %s into KbUnavailableError', async (_label, reply) => {
    const { fetch } = fakeFetch(reply)
    const kb = createKbClient({ baseUrl: 'http://kb.test', internalToken: 'tok', timeoutMs: 1000, fetch })
    await expect(kb.search('t', 'q', 'r')).rejects.toBeInstanceOf(KbUnavailableError)
  })

  it('gives up on a slow kb-service after the timeout', async () => {
    const { fetch } = fakeFetch(
      (_url, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
    )
    const kb = createKbClient({ baseUrl: 'http://kb.test', internalToken: 'tok', timeoutMs: 20, fetch })
    await expect(kb.search('t', 'q', 'r')).rejects.toBeInstanceOf(KbUnavailableError)
  })
})

describe('createAgentConfigClient', () => {
  const published = { tenantName: 'Shop', config: DEFAULT_AGENT_CONFIG }

  it('fetches as the chat caller and caches per tenant', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, published))
    const client = createAgentConfigClient({ baseUrl: 'http://ta.test', internalToken: 'tok', cacheTtlMs: 60_000, fetch })
    expect(await client.getPublished('t1', 'r')).toEqual(published)
    await client.getPublished('t1', 'r')
    await client.getPublished('t2', 'r')
    expect(calls.map((c) => c.url)).toEqual(['http://ta.test/internal/agent-config/t1', 'http://ta.test/internal/agent-config/t2'])
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get('x-internal-caller')).toBe('chat')
    expect(headers.get('x-internal-token')).toBe('tok')
  })

  it('reports a suspended or unknown shop, and does not cache failures', async () => {
    let status = 403
    const { fetch, calls } = fakeFetch(() =>
      status === 200 ? json(200, published) : json(status, { error: { code: status === 403 ? 'tenant_suspended' : 'tenant_not_found' } }),
    )
    const client = createAgentConfigClient({ baseUrl: 'http://ta.test', internalToken: 'tok', cacheTtlMs: 60_000, fetch })
    await expect(client.getPublished('t1', 'r')).rejects.toMatchObject({ status: 403, code: 'tenant_suspended' })
    status = 404
    await expect(client.getPublished('t1', 'r')).rejects.toMatchObject({ status: 404, code: 'tenant_not_found' })
    status = 200
    expect(await client.getPublished('t1', 'r')).toEqual(published)
    expect(calls).toHaveLength(3)
  })

  it('maps other failures to 503 config_unavailable', async () => {
    for (const reply of [() => json(500, {}), () => json(403, { error: { code: 'forbidden' } }), () => Promise.reject(new Error('down'))]) {
      const client = createAgentConfigClient({ baseUrl: 'http://ta.test', internalToken: 'tok', cacheTtlMs: 1, fetch: fakeFetch(reply).fetch })
      const err = await client.getPublished('t', 'r').catch((e) => e)
      expect(err).toBeInstanceOf(AppError)
      expect(err).toMatchObject({ status: 503, code: 'config_unavailable' })
    }
  })
})
