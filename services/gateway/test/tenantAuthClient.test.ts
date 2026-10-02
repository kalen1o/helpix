import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTenantAuthClient } from '../src/tenantAuthClient'
import { startEcho, TEST_INTERNAL_TOKEN } from './helpers'

let echo: Awaited<ReturnType<typeof startEcho>>

beforeEach(async () => {
  echo = await startEcho()
})
afterEach(async () => {
  await echo.close()
})

describe('tenant-auth client', () => {
  it('calls /internal/resolve-admin with the internal token, the resolver caller header and the request id', async () => {
    await createTenantAuthClient(echo.url, TEST_INTERNAL_TOKEN).resolveAdmin('tok', 'req-1')
    const call = echo.calls[0]!
    expect(call.url).toBe('/internal/resolve-admin')
    expect(call.headers['x-internal-token']).toBe(TEST_INTERNAL_TOKEN)
    expect(call.headers['x-internal-caller']).toBe('resolver')
    expect(call.headers['x-request-id']).toBe('req-1')
    expect(JSON.parse(call.body!)).toEqual({ accessToken: 'tok' })
  })

  it('calls /internal/resolve-widget with the key, the origin and the resolver caller header', async () => {
    await createTenantAuthClient(echo.url, TEST_INTERNAL_TOKEN).resolveWidget('wk_1', 'https://shop.example', 'req-1')
    const call = echo.calls[0]!
    expect(call.url).toBe('/internal/resolve-widget')
    expect(call.headers['x-internal-caller']).toBe('resolver')
    expect(call.headers['x-request-id']).toBe('req-1')
    expect(JSON.parse(call.body!)).toEqual({ widgetKey: 'wk_1', origin: 'https://shop.example' })
  })

  it('sends the customer token to resolve-widget only when there is one', async () => {
    const client = createTenantAuthClient(echo.url, TEST_INTERNAL_TOKEN)
    await client.resolveWidget('wk_1', 'https://shop.example', 'req-1', 'h.p.s')
    await client.resolveWidget('wk_1', 'https://shop.example', 'req-2')
    expect(JSON.parse(echo.calls[0]!.body!)).toEqual({ widgetKey: 'wk_1', origin: 'https://shop.example', customerToken: 'h.p.s' })
    expect(JSON.parse(echo.calls[1]!.body!)).toEqual({ widgetKey: 'wk_1', origin: 'https://shop.example' })
  })

  it('passes a 401 invalid_customer_token from resolve-widget through', async () => {
    const stub = Fastify()
    stub.post('/internal/resolve-widget', async (_req, reply) =>
      reply.code(401).send({ error: { code: 'invalid_customer_token', message: 'Invalid customer token', requestId: 'r' } }),
    )
    await stub.listen({ port: 0, host: '127.0.0.1' })
    const { port } = stub.server.address() as AddressInfo
    try {
      await expect(
        createTenantAuthClient(`http://127.0.0.1:${port}`, TEST_INTERNAL_TOKEN).resolveWidget('wk_1', 'https://shop.example', 'req-3', 'h.p.s'),
      ).rejects.toMatchObject({ status: 401, code: 'invalid_customer_token' })
    } finally {
      await stub.close()
    }
  })

  it('passes a 403 from resolve-widget through with its code', async () => {
    const stub = Fastify()
    stub.post('/internal/resolve-widget', async (_req, reply) =>
      reply.code(403).send({ error: { code: 'origin_not_allowed', message: 'Not allowed', requestId: 'r' } }),
    )
    await stub.listen({ port: 0, host: '127.0.0.1' })
    const { port } = stub.server.address() as AddressInfo
    try {
      await expect(
        createTenantAuthClient(`http://127.0.0.1:${port}`, TEST_INTERNAL_TOKEN).resolveWidget('wk_1', 'https://evil.example', 'req-2'),
      ).rejects.toMatchObject({ status: 403, code: 'origin_not_allowed' })
    } finally {
      await stub.close()
    }
  })
})
