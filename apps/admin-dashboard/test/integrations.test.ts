// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { apiKeyProblem, baseUrlProblem, HOST_CHANGED_KEY_PROBLEM, hostChanged, publicKeyProblem, TEST_HEADLINE } from '../src/lib/integrations'

const PEM = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----'

describe('baseUrlProblem', () => {
  it.each(['https://shop.example/api', 'http://localhost:4101', ' https://shop.example/api/ '])('accepts %s', (url) => {
    expect(baseUrlProblem(url)).toBeNull()
  })

  it.each([
    ['', 'Enter the base URL of your order API.'],
    ['shop.example/api', 'Enter a full URL, like https://shop.example/api.'],
    ['ftp://shop.example', 'Use an https:// (or http://) URL.'],
    ['https://user:pw@shop.example', "Don't put a username or password in the URL. The API key is sent separately."],
    ['https://shop.example/api?x=1', 'Remove the ? query or # part. Helpix adds /orders to this URL itself.'],
    ['https://shop.example/api#top', 'Remove the ? query or # part. Helpix adds /orders to this URL itself.'],
    ['https://shop.example/api?', 'Remove the ? query or # part. Helpix adds /orders to this URL itself.'],
    [`https://shop.example/${'a'.repeat(500)}`, 'The URL is limited to 500 characters.'],
  ])('rejects %j', (url, problem) => {
    expect(baseUrlProblem(url)).toBe(problem)
  })
})

describe('apiKeyProblem', () => {
  it('requires a key only when none is stored', () => {
    expect(apiKeyProblem('', true)).toBe('Enter the API key your shop gave Helpix.')
    expect(apiKeyProblem('', false)).toBeNull()
  })

  it('checks the length', () => {
    expect(apiKeyProblem('short', false)).toBe('The API key must be at least 8 characters.')
    expect(apiKeyProblem('k'.repeat(8), true)).toBeNull()
    expect(apiKeyProblem('k'.repeat(500), true)).toBeNull()
    expect(apiKeyProblem('k'.repeat(501), true)).toBe('The API key is limited to 500 characters.')
  })
})

describe('hostChanged', () => {
  it('is true only when a saved URL exists and the typed one has another origin', () => {
    expect(hostChanged('https://shop.example/api', 'https://evil.example')).toBe(true)
    expect(hostChanged('https://shop.example/api', 'http://shop.example/api')).toBe(true)
    expect(hostChanged('https://shop.example/api', 'https://shop.example:8443/api')).toBe(true)
    expect(hostChanged('https://shop.example/api', ' https://SHOP.example:443/v2/ ')).toBe(false)
    expect(hostChanged(null, 'https://evil.example')).toBe(false)
    expect(hostChanged('https://shop.example/api', 'not a url')).toBe(false)
  })

  it('uses the same words as the server', () => {
    expect(HOST_CHANGED_KEY_PROBLEM).toBe('Enter the API key again when changing the order API host.')
  })
})

describe('publicKeyProblem', () => {
  it('accepts a PEM public key', () => {
    expect(publicKeyProblem(`\n${PEM}\n`)).toBeNull()
  })

  it.each([
    ['', 'Paste or upload the public key.'],
    ['-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', 'This is a private key. Keep it on your shop and paste the public key instead.'],
    ['-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----', 'This is a private key. Keep it on your shop and paste the public key instead.'],
    ['ssh-rsa AAAAB3NzaC1yc2E', 'Paste a PEM public key that starts with -----BEGIN PUBLIC KEY-----.'],
    [`${PEM}${'A'.repeat(10240)}`, 'That is too large for a public key (10 KB at most).'],
  ])('rejects %j', (pem, problem) => {
    expect(publicKeyProblem(pem)).toBe(problem)
  })
})

it('has a test headline for every lookup status', () => {
  for (const status of ['ok', 'not_found', 'unavailable', 'misconfigured', 'not_configured'] as const) {
    expect(TEST_HEADLINE[status]).toMatch(/\S/)
  }
})
