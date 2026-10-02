import { createHash, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseShopPublicKey } from '../src/lib/shopKey'
import { newShopKeyPair, type ShopKeyPair } from './helpers'

let shop: ShopKeyPair
beforeAll(async () => { shop = await newShopKeyPair() })

const pemOf = (k: KeyObject) => String(k.export({ type: 'spki', format: 'pem' }))

async function rejection(pem: string) {
  const err = await parseShopPublicKey(pem).catch((e) => e)
  expect(err).toMatchObject({ status: 400, code: 'invalid_public_key' })
  return err
}

describe('parseShopPublicKey', () => {
  it('accepts an RSA 2048 SPKI PEM and fingerprints its DER', async () => {
    const parsed = await parseShopPublicKey(`\n  ${shop.publicPem}  \n`)
    const der = createPublicKey(shop.publicPem).export({ type: 'spki', format: 'der' })
    const hex = createHash('sha256').update(der).digest('hex')
    expect(parsed.fingerprint).toMatch(/^([0-9a-f]{2}:){31}[0-9a-f]{2}$/)
    expect(parsed.fingerprint.replaceAll(':', '')).toBe(hex)
    expect(parsed.pem).toContain('-----BEGIN PUBLIC KEY-----')
    expect(createPublicKey(parsed.pem).export({ type: 'spki', format: 'der' }).equals(der)).toBe(true)
  })

  it('gives the same fingerprint for the same key and a different one for another key', async () => {
    const other = await newShopKeyPair()
    const a = await parseShopPublicKey(shop.publicPem)
    expect((await parseShopPublicKey(shop.publicPem)).fingerprint).toBe(a.fingerprint)
    expect((await parseShopPublicKey(other.publicPem)).fingerprint).not.toBe(a.fingerprint)
  })

  it('rejects an RSA key under 2048 bits', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 })
    const err = await rejection(pemOf(publicKey))
    expect(err.message).toContain('2048')
  })

  it('rejects non-RSA keys', async () => {
    await rejection(pemOf(generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey))
    await rejection(pemOf(generateKeyPairSync('ed25519').publicKey))
  })

  it('rejects a private key, a PKCS#1 public key and extra PEM blocks', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    await rejection(String(privateKey.export({ type: 'pkcs8', format: 'pem' })))
    await rejection(String(publicKey.export({ type: 'pkcs1', format: 'pem' })))
    await rejection(`${pemOf(publicKey)}${String(privateKey.export({ type: 'pkcs8', format: 'pem' }))}`)
  })

  it('rejects garbage, empty input and anything over 10240 characters', async () => {
    await rejection('hello')
    await rejection('')
    await rejection('-----BEGIN PUBLIC KEY-----\nnot-base64!!\n-----END PUBLIC KEY-----')
    await rejection(`-----BEGIN PUBLIC KEY-----\n${'A'.repeat(10_300)}\n-----END PUBLIC KEY-----`)
  })
})
