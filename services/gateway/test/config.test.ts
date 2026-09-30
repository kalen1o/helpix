import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

const ENV = { INTERNAL_TOKEN: 'i'.repeat(32), TENANT_AUTH_URL: 'http://tenant-auth:4001' }

describe('loadConfig', () => {
  it('accepts a 32-character internal token', () => {
    expect(loadConfig(ENV).internalToken).toBe('i'.repeat(32))
  })

  it('rejects an internal token shorter than 32 characters', () => {
    expect(() => loadConfig({ ...ENV, INTERNAL_TOKEN: 'i'.repeat(31) })).toThrow('INTERNAL_TOKEN must be at least 32 characters')
  })

  it('rejects a missing internal token', () => {
    expect(() => loadConfig({ ...ENV, INTERNAL_TOKEN: undefined })).toThrow('Missing required env var INTERNAL_TOKEN')
  })
})
