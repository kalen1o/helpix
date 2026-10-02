import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

const MASTER = Buffer.alloc(32, 9).toString('base64')
const ENV = {
  DATABASE_URL: 'postgres://x',
  INTERNAL_TOKEN: 'i'.repeat(32),
  ADMIN_JWT_SECRET: 's'.repeat(32),
  SECRETS_MASTER_KEY: MASTER,
}

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

  it('decodes a 32-byte base64 secrets master key', () => {
    const key = loadConfig(ENV).secretsMasterKey
    expect(key).toBeInstanceOf(Buffer)
    expect(key.equals(Buffer.alloc(32, 9))).toBe(true)
    expect(loadConfig({ ...ENV, SECRETS_MASTER_KEY: ` ${MASTER}\n` }).secretsMasterKey.equals(Buffer.alloc(32, 9))).toBe(true)
  })

  it('refuses to start without a master key or with the wrong length', () => {
    expect(() => loadConfig({ ...ENV, SECRETS_MASTER_KEY: undefined })).toThrow('Missing required env var SECRETS_MASTER_KEY')
    expect(() => loadConfig({ ...ENV, SECRETS_MASTER_KEY: Buffer.alloc(16).toString('base64') })).toThrow(
      'SECRETS_MASTER_KEY must be base64 of exactly 32 bytes',
    )
    expect(() => loadConfig({ ...ENV, SECRETS_MASTER_KEY: Buffer.alloc(33).toString('base64') })).toThrow('exactly 32 bytes')
    expect(() => loadConfig({ ...ENV, SECRETS_MASTER_KEY: 'not base64 at all, but long enough to be 32 bytes!!' })).toThrow('exactly 32 bytes')
  })

  it('allows private order API hosts only when explicitly set to true', () => {
    expect(loadConfig(ENV).orderApiAllowPrivateHosts).toBe(false)
    expect(loadConfig({ ...ENV, ORDER_API_ALLOW_PRIVATE_HOSTS: 'false' }).orderApiAllowPrivateHosts).toBe(false)
    expect(loadConfig({ ...ENV, ORDER_API_ALLOW_PRIVATE_HOSTS: 'yes' }).orderApiAllowPrivateHosts).toBe(false)
    expect(loadConfig({ ...ENV, ORDER_API_ALLOW_PRIVATE_HOSTS: 'true' }).orderApiAllowPrivateHosts).toBe(true)
  })
})
