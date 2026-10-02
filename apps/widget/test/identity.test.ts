import { isReactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIdentity, customerIdOf, setToken } from '../src/identity'
import { fakeJwt } from './helpers'

afterEach(() => vi.restoreAllMocks())

describe('customerIdOf', () => {
  it('reads sub from a JWT payload without verifying it', () => {
    expect(customerIdOf(fakeJwt({ sub: 'cust_maya', aud: 'wk_1', exp: 2_000_000_000 }))).toBe('cust_maya')
  })

  it('decodes base64url payloads, including non-ASCII ids', () => {
    expect(customerIdOf(fakeJwt({ sub: 'kundé/42?' }))).toBe('kundé/42?')
  })

  it('accepts a 200-character sub and rejects longer ones', () => {
    expect(customerIdOf(fakeJwt({ sub: 'x'.repeat(200) }))).toBe('x'.repeat(200))
    expect(customerIdOf(fakeJwt({ sub: 'x'.repeat(201) }))).toBeNull()
  })

  it.each([
    ['an empty string', ''],
    ['two parts', 'aaa.bbb'],
    ['four parts', 'a.b.c.d'],
    ['an empty payload', 'aaa..ccc'],
    ['a payload that is not base64', 'aaa.!!!.ccc'],
    ['a payload that is not JSON', `aaa.${btoa('not json')}.ccc`],
    ['a JSON payload that is not an object', `aaa.${btoa('42')}.ccc`],
    ['a null payload', `aaa.${btoa('null')}.ccc`],
  ])('returns null for %s', (_label, jwt) => {
    expect(customerIdOf(jwt)).toBeNull()
  })

  it.each([
    ['missing', {}],
    ['empty', { sub: '' }],
    ['a number', { sub: 1001 }],
    ['null', { sub: null }],
  ])('returns null when sub is %s', (_label, payload) => {
    expect(customerIdOf(fakeJwt(payload))).toBeNull()
  })
})

describe('identity', () => {
  it('starts anonymous and is reactive', () => {
    const identity = createIdentity()
    expect(identity).toEqual({ token: null, customerId: null })
    expect(isReactive(identity)).toBe(true)
  })

  it('setToken switches to the shopper and back to a guest', () => {
    const identity = createIdentity()
    const jwt = fakeJwt({ sub: 'cust_maya' })
    setToken(identity, jwt)
    expect(identity).toEqual({ token: jwt, customerId: 'cust_maya' })
    setToken(identity, null)
    expect(identity).toEqual({ token: null, customerId: null })
  })

  it('treats an unreadable token as a guest and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const identity = createIdentity()
    setToken(identity, fakeJwt({ sub: 'cust_maya' }))
    setToken(identity, 'garbage')
    expect(identity).toEqual({ token: null, customerId: null })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('[helpix]')
  })

  it('treats a non-string from page script as a guest', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const identity = createIdentity()
    setToken(identity, 42 as unknown as string)
    expect(identity).toEqual({ token: null, customerId: null })
  })
})
