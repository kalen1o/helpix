import { exportPKCS8, importPKCS8, SignJWT, UnsecuredJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { verifyCustomerToken } from '../src/lib/customerToken'
import { customerClaims, mintCustomerToken, newShopKeyPair, nowSeconds, type ShopKeyPair } from './helpers'

const AUD = 'wk_orchard_widget_key'
let shop: ShopKeyPair
let other: ShopKeyPair

beforeAll(async () => {
  shop = await newShopKeyPair()
  other = await newShopKeyPair()
})

const verify = (token: string, audience = AUD, pem = shop.publicPem) => verifyCustomerToken(token, { pem, audience })

async function rejects(token: string, audience = AUD, pem = shop.publicPem) {
  const err = await verify(token, audience, pem).catch((e) => e)
  expect(err).toMatchObject({ status: 401, code: 'invalid_customer_token' })
}

describe('verifyCustomerToken', () => {
  it('returns the customer ID and exp of a valid token', async () => {
    const claims = customerClaims(AUD, { email: 'maya@orchard.demo' })
    const token = await mintCustomerToken(shop.privateKey, claims)
    expect(await verify(token)).toEqual({ customerId: 'cust_maya', exp: claims.exp })
  })

  it("rejects a token signed by another shop's key", async () => {
    await rejects(await mintCustomerToken(other.privateKey, customerClaims(AUD)))
  })

  it('rejects a token for another widget key, or with no aud', async () => {
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims('wk_some_other_tenant')))
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { aud: undefined })))
  })

  it('rejects an expired token, allowing 30 s of clock skew', async () => {
    const now = nowSeconds()
    expect((await verify(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { iat: now - 600, exp: now - 10 })))).customerId).toBe(
      'cust_maya',
    )
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { iat: now - 600, exp: now - 60 })))
  })

  it('requires exp and iat, at most one hour apart', async () => {
    const now = nowSeconds()
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { exp: undefined })))
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { iat: undefined })))
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { iat: now - 100, exp: now - 100 + 3601 })))
    expect(await verify(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { iat: now - 100, exp: now - 100 + 3600 })))).toMatchObject({
      customerId: 'cust_maya',
    })
  })

  it('rejects a token issued in the future', async () => {
    const now = nowSeconds()
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { iat: now + 600, exp: now + 1200 })))
  })

  it('requires sub to be a string of 1–200 characters', async () => {
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { sub: undefined })))
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { sub: '' })))
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { sub: 'c'.repeat(201) })))
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { sub: 42 })))
    expect((await verify(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { sub: 'c'.repeat(200) })))).customerId).toHaveLength(200)
  })

  it('rejects tokens over 4096 characters before verifying them', async () => {
    const token = await mintCustomerToken(shop.privateKey, customerClaims(AUD, { pad: 'x'.repeat(4000) }))
    expect(token.length).toBeGreaterThan(4096)
    await rejects(token)
    await rejects('')
  })

  it('accepts only RS256: not PS256 with the same key, and never alg none', async () => {
    const pss = await importPKCS8(await exportPKCS8(shop.privateKey), 'PS256')
    await rejects(await mintCustomerToken(pss, customerClaims(AUD), 'PS256'))
    await rejects(new UnsecuredJWT(customerClaims(AUD)).encode())
  })

  it('rejects an array aud that merely contains the widget key', async () => {
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { aud: [AUD, 'wk_other'] })))
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims(AUD, { aud: [AUD] })))
  })

  it('rejects HS256 algorithm confusion using the public key PEM as the HMAC secret', async () => {
    const token = await new SignJWT(customerClaims(AUD)).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(shop.publicPem))
    await rejects(token)
  })

  it('rejects malformed tokens and an unusable key', async () => {
    await rejects('not-a-jwt')
    await rejects('a.b.c')
    await rejects(await mintCustomerToken(shop.privateKey, customerClaims(AUD)), AUD, 'not a pem')
  })
})
