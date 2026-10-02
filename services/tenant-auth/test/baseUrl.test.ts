import { describe, expect, it, vi } from 'vitest'
import { assertPublicHost, isBlockedAddress, normalizeBaseUrl, type LookupFn } from '../src/lib/baseUrl'

const resolvesTo = (...addresses: string[]) =>
  vi.fn<LookupFn>(async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })))

async function blocked(p: Promise<void>) {
  await expect(p).rejects.toMatchObject({ status: 400, code: 'invalid_base_url' })
}

describe('normalizeBaseUrl', () => {
  it('normalizes the origin and strips trailing slashes', () => {
    expect(normalizeBaseUrl('  HTTPS://Shop.Example:443/api/v1/  ')).toBe('https://shop.example/api/v1')
    expect(normalizeBaseUrl('http://localhost:4101/')).toBe('http://localhost:4101')
    expect(normalizeBaseUrl('https://shop.example')).toBe('https://shop.example')
    expect(normalizeBaseUrl('https://shop.example:8443/orders-api//')).toBe('https://shop.example:8443/orders-api')
  })

  it.each([
    ['empty', ''],
    ['relative', 'shop.example/api'],
    ['not a URL', 'not a url'],
    ['ftp', 'ftp://shop.example'],
    ['javascript', 'javascript:alert(1)'],
    ['credentials', 'https://user:pass@shop.example'],
    ['a username', 'https://user@shop.example'],
    ['a query string', 'https://shop.example/api?key=1'],
    ['an empty query', 'https://shop.example/api?'],
    ['a fragment', 'https://shop.example/api#orders'],
    ['over 500 characters', `https://shop.example/${'a'.repeat(490)}`],
  ])('rejects %s', (_label, input) => {
    expect(() => normalizeBaseUrl(input)).toThrow(expect.objectContaining({ status: 400, code: 'invalid_base_url' }))
  })
})

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '100.127.255.255', '0.0.0.0', '0.1.2.3', '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip',
    '::7f00:1', '::a00:1', '64:ff9b::7f00:1', '2002:7f00:1::1', '::ffff:0:7f00:1', '198.18.0.1', '198.19.255.255', '224.0.0.1', '239.255.255.255', '255.255.255.255',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each(['8.8.8.8', '93.184.216.34', '172.32.0.1', '172.15.255.255', '100.128.0.1', '192.169.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false)
    },
  )
})

describe('assertPublicHost', () => {
  it('skips every check when private hosts are allowed', async () => {
    const lookup = resolvesTo('127.0.0.1')
    await assertPublicHost('http://localhost:4001', true, lookup)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('requires https', async () => {
    await blocked(assertPublicHost('http://shop.example', false, resolvesTo('93.184.216.34')))
  })

  it('accepts a host that resolves only to public addresses', async () => {
    const lookup = resolvesTo('93.184.216.34', '2606:4700::1111')
    await assertPublicHost('https://shop.example/api', false, lookup)
    expect(lookup).toHaveBeenCalledWith('shop.example')
  })

  it('rejects a host with any private address among its answers', async () => {
    await blocked(assertPublicHost('https://shop.example', false, resolvesTo('93.184.216.34', '10.0.0.5')))
    await blocked(assertPublicHost('https://localhost', false, resolvesTo('127.0.0.1', '::1')))
  })

  it('checks IP literals without DNS', async () => {
    const lookup = resolvesTo('93.184.216.34')
    await blocked(assertPublicHost('https://169.254.169.254/latest', false, lookup))
    await blocked(assertPublicHost('https://127.0.0.1:4001', false, lookup))
    await blocked(assertPublicHost('https://[::1]:4001', false, lookup))
    for (const u of ['https://2130706433', 'https://0x7f.1', 'https://0177.0.0.1', 'https://[::ffff:127.0.0.1]', 'https://[::127.0.0.1]']) {
      await blocked(assertPublicHost(u, false, lookup))
    }
    await assertPublicHost('https://93.184.216.34', false, lookup)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects a host that does not resolve', async () => {
    await blocked(assertPublicHost('https://nope.invalid', false, vi.fn<LookupFn>(async () => { throw new Error('ENOTFOUND') })))
    await blocked(assertPublicHost('https://empty.example', false, resolvesTo()))
  })
})
