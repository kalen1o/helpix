import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@helpix/shared'
import { buildGateway } from '../src/app'
import type { TenantAuthClient } from '../src/tenantAuthClient'
import { rawRequest, startEcho, testConfig } from './helpers'

const tenantAuth: TenantAuthClient = {
  resolveAdmin: vi.fn(async (token: string) => {
    if (token !== 'tenant-token') throw new AppError(401, 'invalid_token', 'Invalid or expired access token')
    return { adminId: 'admin-a', role: 'tenant_admin' as const, tenantId: 'tenant-a' }
  }),
}
const bearer = { authorization: 'Bearer tenant-token' }

describe('gateway /agent/* and /chat/* routes', () => {
  let auth: Awaited<ReturnType<typeof startEcho>>
  let chat: Awaited<ReturnType<typeof startEcho>>
  let gw: FastifyInstance

  beforeEach(async () => {
    auth = await startEcho()
    chat = await startEcho()
    gw = await buildGateway({ config: testConfig(auth.url, auth.url, chat.url), tenantAuth })
  })
  afterEach(async () => {
    await gw.close()
    await auth.close()
    await chat.close()
  })

  it('forwards /agent/config to tenant-auth with the tenant identity', async () => {
    const res = await gw.inject({ method: 'PUT', url: '/agent/config/draft', headers: { ...bearer, 'content-type': 'application/json' }, payload: '{}' })
    expect(res.statusCode).toBe(200)
    expect(auth.calls.map((c) => c.url)).toEqual(['/agent/config/draft'])
    expect(auth.calls[0]!.headers['x-tenant-id']).toBe('tenant-a')
    expect(chat.calls).toHaveLength(0)
  })

  it('forwards /chat/* to chat-service with the tenant identity and without the bearer token', async () => {
    const res = await gw.inject({ method: 'GET', url: '/chat/conversations?kind=playground', headers: { ...bearer, 'x-customer-id': 'spoofed' } })
    expect(res.statusCode).toBe(200)
    const call = chat.calls[0]!
    expect(call.url).toBe('/chat/conversations?kind=playground')
    expect(call.headers['x-tenant-id']).toBe('tenant-a')
    expect(call.headers['x-helpix-role']).toBe('tenant_admin')
    expect(call.headers['x-customer-id']).toBeUndefined()
    expect(call.headers.authorization).toBeUndefined()
  })

  it('requires a bearer token', async () => {
    expect((await gw.inject({ method: 'GET', url: '/chat/models' })).statusCode).toBe(401)
    expect((await gw.inject({ method: 'GET', url: '/agent/config' })).statusCode).toBe(401)
    expect(chat.calls).toHaveLength(0)
  })

  it('rejects path traversal out of /chat and /agent', async () => {
    await gw.listen({ port: 0, host: '127.0.0.1' })
    const { port } = gw.server.address() as AddressInfo
    for (const path of ['/chat/../admin/tenants', '/agent/%2e%2e/internal/agent-config/x', '/chat/%2e%2e/kb/documents']) {
      expect((await rawRequest(port, { method: 'GET', path, headers: bearer })).status).toBe(404)
    }
    expect(chat.calls).toHaveLength(0)
    expect(auth.calls).toHaveLength(0)
  })
})

/** An upstream that sends one SSE event, then holds the response open until `release()`. */
async function startSseUpstream() {
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  let markClosed!: () => void
  const closed = new Promise<void>((resolve) => (markClosed = resolve))
  const server = http.createServer((req, res) => {
    req.resume()
    res.on('close', () => markClosed())
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
    res.write('event: delta\ndata: {"text":"Hi"}\n\n')
    void released.then(() => res.end('event: done\ndata: {"messageId":"m1"}\n\n'))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    release,
    closed,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

describe('streaming through the gateway', () => {
  let up: Awaited<ReturnType<typeof startSseUpstream>>
  let gw: FastifyInstance
  let base: string

  beforeEach(async () => {
    up = await startSseUpstream()
    gw = await buildGateway({ config: testConfig(up.url, up.url, up.url), tenantAuth })
    await gw.listen({ port: 0, host: '127.0.0.1' })
    base = `http://127.0.0.1:${(gw.server.address() as AddressInfo).port}`
  })
  afterEach(async () => {
    up.release()
    await gw.close()
    await up.close()
  })

  const open = (signal?: AbortSignal) =>
    fetch(`${base}/chat/playground`, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: '{}', signal })

  it('passes SSE events through as they are produced', async () => {
    const res = await open()
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let first = ''
    while (!first.includes('\n\n')) first += decoder.decode((await reader.read()).value, { stream: true })
    expect(first).toContain('"text":"Hi"')
    up.release()
    let rest = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      rest += decoder.decode(value, { stream: true })
    }
    expect(rest).toContain('event: done')
  })

  it('closes the upstream request when the client disconnects', async () => {
    const ac = new AbortController()
    const res = await open(ac.signal)
    await res.body!.getReader().read()
    ac.abort()
    // Resolves only once the gateway has dropped its connection to the upstream (the test times out otherwise).
    await up.closed
  })
})

describe('client leaving before the upstream answers', () => {
  it('closes the upstream request when the client aborts before headers arrive', async () => {
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    let markReceived!: () => void
    const received = new Promise<void>((resolve) => (markReceived = resolve))
    let markClosed!: () => void
    const closed = new Promise<void>((resolve) => (markClosed = resolve))
    const server = http.createServer((req, res) => {
      req.resume()
      res.on('close', () => markClosed())
      markReceived()
      void released.then(() => {
        if (!res.destroyed) res.writeHead(200).end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const gw = await buildGateway({ config: testConfig(url, url, url), tenantAuth })
    try {
      await gw.listen({ port: 0, host: '127.0.0.1' })
      const base = `http://127.0.0.1:${(gw.server.address() as AddressInfo).port}`
      const ac = new AbortController()
      const pending = fetch(`${base}/chat/playground`, {
        method: 'POST',
        headers: { ...bearer, 'content-type': 'application/json' },
        body: '{}',
        signal: ac.signal,
      }).catch(() => undefined)
      await received
      ac.abort()
      await pending
      // Resolves only once the gateway dropped its upstream request (the test times out otherwise).
      await closed
    } finally {
      release()
      await gw.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 10_000)
})
