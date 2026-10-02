// @vitest-environment node
import { importSPKI, jwtVerify } from 'jose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cookieOf, loginAs, setCookieOf, startShop, WIDGET_KEY, type TestShop } from './helpers'

let shop: TestShop
beforeEach(async () => {
  shop = await startShop()
})
afterEach(async () => {
  await shop.close()
})

const signup = (payload: Record<string, unknown>) => shop.app.inject({ method: 'POST', url: '/api/signup', payload })

describe('signup', () => {
  it('creates an account with a lowercased email and signs the shopper in', async () => {
    const res = await signup({ name: '  Jo Park ', email: 'Jo@Example.COM', password: 'long-enough' })
    expect(res.statusCode).toBe(201)
    const { customer } = res.json()
    expect(customer).toEqual({ id: expect.stringMatching(/^cust_[0-9a-f]{12}$/), name: 'Jo Park', email: 'jo@example.com' })
    const cookie = setCookieOf(res)
    expect(cookie).toMatch(/^orchard_session=cust_[0-9a-f]{12}\.[A-Za-z0-9_-]+;/)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=604800')

    const me = await shop.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookieOf(res) } })
    expect(me.json().customer).toEqual(customer)
  })

  it.each([
    [{ name: '', email: 'a@b.co', password: 'long-enough' }, 'invalid_name', 'name'],
    [{ name: '   ', email: 'a@b.co', password: 'long-enough' }, 'invalid_name', 'name'],
    [{ name: 'x'.repeat(81), email: 'a@b.co', password: 'long-enough' }, 'invalid_name', 'name'],
    [{ name: 'Jo', email: 'not-an-email', password: 'long-enough' }, 'invalid_email', 'email'],
    [{ name: 'Jo', email: 'a@b.co', password: 'short' }, 'weak_password', 'password'],
  ])('rejects %j with %s', async (payload, code, field) => {
    const res = await signup(payload)
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code, field })
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('rejects a missing field', async () => {
    const res = await signup({ name: 'Jo', email: 'a@b.co' })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an email that already has an account, whatever its case', async () => {
    const res = await signup({ name: 'Maya Again', email: 'MAYA@orchard.demo', password: 'long-enough' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: 'email_taken', field: 'email' })
  })
})

describe('login', () => {
  it('signs in a seeded customer', async () => {
    const res = await shop.app.inject({ method: 'POST', url: '/api/login', payload: { email: 'Maya@Orchard.demo', password: 'orchard-demo' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().customer).toEqual({ id: 'cust_maya', name: 'Maya Chen', email: 'maya@orchard.demo' })
    expect(setCookieOf(res)).toMatch(/^orchard_session=cust_maya\./)
  })

  it('gives the same error for a wrong email and a wrong password', async () => {
    const wrongEmail = await shop.app.inject({ method: 'POST', url: '/api/login', payload: { email: 'nobody@orchard.demo', password: 'orchard-demo' } })
    const wrongPassword = await shop.app.inject({ method: 'POST', url: '/api/login', payload: { email: 'maya@orchard.demo', password: 'not-her-password' } })
    expect(wrongEmail.statusCode).toBe(401)
    expect(wrongPassword.statusCode).toBe(401)
    expect(wrongEmail.json()).toEqual(wrongPassword.json())
    expect(wrongEmail.json()).toEqual({ error: { code: 'invalid_credentials', message: 'Email or password is incorrect' } })
    expect(wrongEmail.headers['set-cookie']).toBeUndefined()
  })
})

describe('/api/me', () => {
  it('is anonymous without a session', async () => {
    const res = await shop.app.inject({ method: 'GET', url: '/api/me' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ customer: null })
  })

  it('mints an RS256 Helpix token for the signed-in customer, valid for one hour', async () => {
    const cookie = await loginAs(shop.app, 'maya@orchard.demo')
    const res = await shop.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    expect(res.headers['cache-control']).toBe('no-store')
    const body = res.json()
    expect(body.customer.id).toBe('cust_maya')
    const { payload, protectedHeader } = await jwtVerify(body.helpixToken, await importSPKI(shop.publicKeyPem, 'RS256'), {
      audience: WIDGET_KEY,
      algorithms: ['RS256'],
    })
    expect(protectedHeader.alg).toBe('RS256')
    expect(payload.sub).toBe('cust_maya')
    expect(payload.aud).toBe(WIDGET_KEY)
    expect(payload.exp! - payload.iat!).toBe(3600)
    expect(Math.abs(payload.iat! - Date.now() / 1000)).toBeLessThan(5)
  })

  it('treats a tampered cookie as signed out and clears it', async () => {
    const cookie = await loginAs(shop.app, 'maya@orchard.demo')
    const forged = cookie.replace('cust_maya', 'cust_leo')
    const res = await shop.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: forged } })
    expect(res.json()).toEqual({ customer: null })
    expect(setCookieOf(res)).toMatch(/^orchard_session=;.*Max-Age=0/)
  })
})

describe('logout', () => {
  it('clears the session cookie', async () => {
    const res = await shop.app.inject({ method: 'POST', url: '/api/logout' })
    expect(res.statusCode).toBe(204)
    expect(setCookieOf(res)).toMatch(/^orchard_session=;.*Max-Age=0/)
  })
})

describe('before make seed-demos', () => {
  it('answers 503 "Run make seed-demos first" where a secret is needed', async () => {
    const bare = await startShop({ seeded: false })
    try {
      const res = await bare.app.inject({ method: 'POST', url: '/api/signup', payload: { name: 'Jo', email: 'jo@x.co', password: 'long-enough' } })
      expect(res.statusCode).toBe(503)
      expect(res.json().error).toEqual({ code: 'not_seeded', message: 'Run make seed-demos first' })
      const me = await bare.app.inject({ method: 'GET', url: '/api/me' })
      expect(me.json()).toEqual({ customer: null })
    } finally {
      await bare.close()
    }
  })
})
