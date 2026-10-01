import type { FastifyRequest } from 'fastify'
import { AppError, readContext, requireRole } from '@helpix/shared'

/** The tenant of a tenant admin, from gateway headers. Super-admins have no tenant and are refused. */
export function adminTenant(req: FastifyRequest): string {
  const ctx = readContext(req)
  requireRole(ctx, 'tenant_admin')
  return ctx.tenantId!
}

/** The tenant of any trusted caller: a tenant admin via the gateway, or an internal service such as chat-service. */
export function scopedTenant(req: FastifyRequest): string {
  const { tenantId } = readContext(req)
  if (!tenantId) throw new AppError(403, 'forbidden', 'Missing tenant context')
  return tenantId
}
