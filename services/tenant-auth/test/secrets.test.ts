import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../src/lib/secrets'

const KEY = Buffer.alloc(32, 7)
const SECRET = 'sk_live_orchard_0123456789'

const b64 = (s: string) => Buffer.from(s, 'base64')

describe('encryptSecret / decryptSecret', () => {
  it('round-trips, in the v1 format, without the plain text', () => {
    const enc = encryptSecret(SECRET, KEY)
    expect(enc).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/)
    expect(enc).not.toContain(SECRET)
    const [, iv, tag] = enc.split(':')
    expect(b64(iv!)).toHaveLength(12)
    expect(b64(tag!)).toHaveLength(16)
    expect(decryptSecret(enc, KEY)).toBe(SECRET)
  })

  it('uses a fresh IV every time', () => {
    expect(encryptSecret(SECRET, KEY)).not.toBe(encryptSecret(SECRET, KEY))
  })

  it('round-trips non-ASCII text', () => {
    expect(decryptSecret(encryptSecret('clé-🔑-秘密', KEY), KEY)).toBe('clé-🔑-秘密')
  })

  it('fails with the wrong master key, without leaking the secret', () => {
    const enc = encryptSecret(SECRET, KEY)
    let err: unknown
    try {
      decryptSecret(enc, randomBytes(32))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    expect(String((err as Error).message)).not.toContain(SECRET)
  })

  it('fails when the ciphertext or tag was tampered with', () => {
    const [v, iv, tag, ct] = encryptSecret(SECRET, KEY).split(':') as [string, string, string, string]
    const flip = (s: string) => {
      const buf = b64(s)
      buf[0] = buf[0]! ^ 1
      return buf.toString('base64')
    }
    expect(() => decryptSecret([v, iv, tag, flip(ct)].join(':'), KEY)).toThrow()
    expect(() => decryptSecret([v, iv, flip(tag), ct].join(':'), KEY)).toThrow()
    expect(() => decryptSecret([v, flip(iv), tag, ct].join(':'), KEY)).toThrow()
  })

  it('rejects unknown versions and malformed values', () => {
    const enc = encryptSecret(SECRET, KEY)
    expect(() => decryptSecret(enc.replace(/^v1:/, 'v2:'), KEY)).toThrow()
    expect(() => decryptSecret('v1:abc', KEY)).toThrow()
    expect(() => decryptSecret('', KEY)).toThrow()
    expect(() => decryptSecret(SECRET, KEY)).toThrow()
  })

  it('refuses a master key that is not 32 bytes', () => {
    expect(() => encryptSecret(SECRET, Buffer.alloc(16))).toThrow('32 bytes')
    expect(() => decryptSecret(encryptSecret(SECRET, KEY), Buffer.alloc(31))).toThrow('32 bytes')
  })
})
