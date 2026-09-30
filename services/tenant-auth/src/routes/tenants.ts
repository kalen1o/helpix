import type { FastifyPluginAsync } from 'fastify'
import { AppError, readContext, requireRole } from '@helpix/shared'
import type { TenantView } from '@helpix/shared/api-types'
import type { RouteDeps } from '../deps'
import { assertValidEmail, normalizeEmail } from '../lib/email'
import { normalizeOrigins } from '../lib/origins'
import { hashPassword, MIN_PASSWORD_LENGTH } from '../lib/passwords'
import { createAdmin, listTenantAdmins, toAdminView } from '../repos/admins'
import {
  createTenant,
  getTenant,
  listTenants,
  rotateWidgetKey,
  setTenantStatus,
  updateTenant,
} from '../repos/tenants'

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const

const createTenantBody = {
  type: 'object',
  required: ['name', 'slug'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    slug: { type: 'string', minLength: 1, maxLength: 50, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
  },
} as const

const patchTenantBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    allowedOrigins: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 200 } },
  },
} as const

const createAdminBody = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 300 },
    password: { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: 200 },
  },
} as const

type IdParams = { Params: { id: string } }

function found(t: TenantView | null): TenantView {
  if (!t) throw new AppError(404, 'tenant_not_found', 'Tenant not found')
  return t
}

export const tenantRoutes: FastifyPluginAsync<RouteDeps> = async (app, { db }) => {
  app.addHook('onRequest', async (req) => requireRole(readContext(req), 'super_admin'))

  app.get('/admin/tenants', async () => ({ tenants: await listTenants(db) }))

  app.post<{ Body: { name: string; slug: string } }>(
    '/admin/tenants',
    { schema: { body: createTenantBody } },
    async (req, reply) => reply.code(201).send(await createTenant(db, { name: req.body.name.trim(), slug: req.body.slug })),
  )

  app.get<IdParams>('/admin/tenants/:id', { schema: { params: idParams } }, async (req) => found(await getTenant(db, req.params.id)))

  app.patch<IdParams & { Body: { name?: string; allowedOrigins?: string[] } }>(
    '/admin/tenants/:id',
    { schema: { params: idParams, body: patchTenantBody } },
    async (req) =>
      found(
        await updateTenant(db, req.params.id, {
          name: req.body.name?.trim(),
          allowedOrigins: req.body.allowedOrigins ? normalizeOrigins(req.body.allowedOrigins) : undefined,
        }),
      ),
  )

  app.post<IdParams>('/admin/tenants/:id/suspend', { schema: { params: idParams } }, async (req) =>
    found(await setTenantStatus(db, req.params.id, 'suspended')),
  )

  app.post<IdParams>('/admin/tenants/:id/reactivate', { schema: { params: idParams } }, async (req) =>
    found(await setTenantStatus(db, req.params.id, 'active')),
  )

  app.post<IdParams>('/admin/tenants/:id/widget-key/rotate', { schema: { params: idParams } }, async (req) =>
    found(await rotateWidgetKey(db, req.params.id)),
  )

  app.get<IdParams>('/admin/tenants/:id/admins', { schema: { params: idParams } }, async (req) => {
    found(await getTenant(db, req.params.id))
    return { admins: (await listTenantAdmins(db, req.params.id)).map(toAdminView) }
  })

  app.post<IdParams & { Body: { email: string; password: string } }>(
    '/admin/tenants/:id/admins',
    { schema: { params: idParams, body: createAdminBody } },
    async (req, reply) => {
      found(await getTenant(db, req.params.id))
      const email = normalizeEmail(req.body.email)
      assertValidEmail(email)
      const row = await createAdmin(db, {
        email,
        passwordHash: await hashPassword(req.body.password),
        role: 'tenant_admin',
        tenantId: req.params.id,
      })
      return reply.code(201).send(toAdminView(row))
    },
  )
}
