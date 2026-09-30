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
})
