import type { IncomingHttpHeaders } from 'node:http'
import type { Role } from './api-types'
import { AppError } from './errors'
import { HEADERS } from './headers'

export interface RequestContext {
  requestId: string
  role?: Role
  adminId?: string
  tenantId?: string
  customerId?: string
}

export function readContext(req: { id: string; headers: IncomingHttpHeaders }): RequestContext {
  const one = (name: string): string | undefined => {
    const v = req.headers[name]
    return typeof v === 'string' && v.length > 0 ? v : undefined
  }
  const role = one(HEADERS.role)
  return {
    requestId: req.id,
    role: role === 'super_admin' || role === 'tenant_admin' ? role : undefined,
    adminId: one(HEADERS.adminId),
    tenantId: one(HEADERS.tenantId),
    customerId: one(HEADERS.customerId),
  }
}

export function requireAdmin(ctx: RequestContext): { adminId: string; role: Role } {
  if (!ctx.adminId || !ctx.role) throw new AppError(401, 'unauthorized', 'Admin authentication required')
  return { adminId: ctx.adminId, role: ctx.role }
}

export function requireRole(ctx: RequestContext, role: Role): void {
  if (ctx.role !== role || !ctx.adminId) throw new AppError(403, 'forbidden', `This action requires role ${role}`)
  if (role === 'tenant_admin' && !ctx.tenantId) throw new AppError(403, 'forbidden', 'Missing tenant context')
}
