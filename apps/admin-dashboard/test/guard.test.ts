import { describe, expect, it } from 'vitest'
import type { MeResponse } from '@helpix/shared/api-types'
import { guard, homeFor } from '../src/auth/guard'

const superMe: MeResponse = {
  admin: { id: 'a0', tenantId: null, email: 'root@helpix.test', role: 'super_admin', createdAt: '' },
  tenant: null,
}
const tenantMe: MeResponse = {
  admin: { id: 'a1', tenantId: 't1', email: 'o@shop.test', role: 'tenant_admin', createdAt: '' },
  tenant: null,
}

describe('guard', () => {
  it('sends logged-out users to /login', () => {
    expect(guard({ role: 'super_admin' }, null, false)).toBe('/login')
    expect(guard({}, null, false)).toBe('/login')
  })

  it('lets logged-out users see public pages', () => {
    expect(guard({ public: true }, null, false)).toBe(true)
  })

  it('sends logged-in users away from public pages to their home', () => {
    expect(guard({ public: true }, superMe, true)).toBe('/tenants')
    expect(guard({ public: true }, tenantMe, true)).toBe('/home')
  })

  it('redirects a role mismatch to the user\'s home', () => {
    expect(guard({ role: 'super_admin' }, tenantMe, true)).toBe('/home')
    expect(guard({ role: 'tenant_admin' }, superMe, true)).toBe('/tenants')
  })

  it('allows a matching role', () => {
    expect(guard({ role: 'super_admin' }, superMe, true)).toBe(true)
  })

  it('treats tokens without a loaded profile as logged out', () => {
    expect(guard({ role: 'super_admin' }, null, true)).toBe('/login')
  })

  it('homeFor maps roles', () => {
    expect(homeFor(superMe)).toBe('/tenants')
    expect(homeFor(tenantMe)).toBe('/home')
  })
})
