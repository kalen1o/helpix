import type { FastifyPluginAsync } from 'fastify'
import { AppError, readContext, requireAdmin } from '@helpix/shared'
import type { MeResponse } from '@helpix/shared/api-types'
import type { RouteDeps } from '../deps'
import { findAdminById, toAdminView } from '../repos/admins'
import { getTenant } from '../repos/tenants'

export const meRoutes: FastifyPluginAsync<RouteDeps> = async (app, { db }) => {
  app.get('/me', async (req): Promise<MeResponse> => {
    const { adminId } = requireAdmin(readContext(req))
    const admin = await findAdminById(db, adminId)
    if (!admin) throw new AppError(401, 'unauthorized', 'Admin no longer exists')
    return { admin: toAdminView(admin), tenant: admin.tenant_id ? await getTenant(db, admin.tenant_id) : null }
  })
}
