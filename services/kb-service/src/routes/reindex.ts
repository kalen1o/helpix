import type { FastifyPluginAsync } from 'fastify'
import type { KbReindexStatus } from '@helpix/shared/api-types'
import type { KbDeps } from '../deps'
import { adminTenant } from '../lib/context'
import { reindexStatus, reindexTenant } from '../reindex'

export const reindexRoutes: FastifyPluginAsync<KbDeps> = async (app, deps) => {
  app.post('/kb/reindex', async (req, reply) => {
    const tenantId = adminTenant(req)
    deps.reindex.start(tenantId, () => reindexTenant(deps, tenantId))
    return reply.code(202).send(await reindexStatus(deps, tenantId))
  })

  app.get('/kb/reindex', async (req): Promise<KbReindexStatus> => reindexStatus(deps, adminTenant(req)))
}
