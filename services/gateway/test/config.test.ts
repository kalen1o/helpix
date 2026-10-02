import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

const ENV = { INTERNAL_TOKEN: 'i'.repeat(32), TENANT_AUTH_URL: 'http://tenant-auth:4001', KB_SERVICE_URL: 'http://kb-service:4002', CHAT_SERVICE_URL: 'http://chat-service:4003' }

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

  it('requires KB_SERVICE_URL and defaults the upload limit to 11 MiB', () => {
    expect(() => loadConfig({ ...ENV, KB_SERVICE_URL: undefined })).toThrow('Missing required env var KB_SERVICE_URL')
    expect(loadConfig(ENV).kbUploadLimitBytes).toBe(11 * 1024 * 1024)
  })

  it('requires CHAT_SERVICE_URL', () => {
    expect(() => loadConfig({ ...ENV, CHAT_SERVICE_URL: undefined })).toThrow('Missing required env var CHAT_SERVICE_URL')
    expect(loadConfig(ENV).chatServiceUrl).toBe('http://chat-service:4003')
  })

  it.each(['BODY_LIMIT_BYTES', 'KB_UPLOAD_LIMIT_BYTES', 'RESOLVE_CACHE_TTL_MS'])('rejects a non-numeric or non-positive %s', (key) => {
    for (const bad of ['abc', '0', '-5', '1.5']) {
      expect(() => loadConfig({ ...ENV, [key]: bad })).toThrow(`${key} must be a positive integer`)
    }
    expect(loadConfig({ ...ENV, [key]: '2048' })).toBeDefined()
  })

  it('defaults the widget bundle path to apps/widget/dist and honours WIDGET_BUNDLE_PATH', () => {
    const base = { INTERNAL_TOKEN: 'x'.repeat(32), TENANT_AUTH_URL: 'http://a', KB_SERVICE_URL: 'http://b', CHAT_SERVICE_URL: 'http://c' }
    expect(loadConfig(base).widgetBundlePath).toMatch(/apps[\\/]widget[\\/]dist[\\/]helpix-widget\.js$/)
    expect(loadConfig({ ...base, WIDGET_BUNDLE_PATH: '/tmp/w.js' }).widgetBundlePath).toBe('/tmp/w.js')
  })
})
