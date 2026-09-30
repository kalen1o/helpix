import { describe, expect, it } from 'vitest'
import { AppError, HEADERS, readContext, requireAdmin, requireRole } from '../src/index'

const req = (headers: Record<string, string>) => ({ id: 'req-1', headers })

describe('readContext', () => {
  it('reads identity headers', () => {
    const ctx = readContext(req({ [HEADERS.role]: 'tenant_admin', [HEADERS.adminId]: 'a1', [HEADERS.tenantId]: 't1' }))
    expect(ctx).toEqual({ requestId: 'req-1', role: 'tenant_admin', adminId: 'a1', tenantId: 't1', customerId: undefined })
  })

  it('ignores an unknown role value', () => {
    expect(readContext(req({ [HEADERS.role]: 'god' })).role).toBeUndefined()
  })
})

describe('requireRole / requireAdmin', () => {
  it('throws 403 when the role does not match', () => {
    const ctx = readContext(req({ [HEADERS.role]: 'tenant_admin', [HEADERS.adminId]: 'a1', [HEADERS.tenantId]: 't1' }))
    expect(() => requireRole(ctx, 'super_admin')).toThrowError(AppError)
    try { requireRole(ctx, 'super_admin') } catch (e) { expect((e as AppError).status).toBe(403) }
  })

  it('throws 403 for a tenant_admin without a tenant id', () => {
    const ctx = readContext(req({ [HEADERS.role]: 'tenant_admin', [HEADERS.adminId]: 'a1' }))
    expect(() => requireRole(ctx, 'tenant_admin')).toThrowError(AppError)
  })

  it('requireAdmin throws 401 without admin headers and returns them otherwise', () => {
    try { requireAdmin(readContext(req({}))) } catch (e) { expect((e as AppError).status).toBe(401) }
    expect(requireAdmin(readContext(req({ [HEADERS.role]: 'super_admin', [HEADERS.adminId]: 'a1' })))).toEqual({ adminId: 'a1', role: 'super_admin' })
  })
})
