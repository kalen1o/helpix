import type { FastifyPluginAsync } from 'fastify'
import { login, logout, refreshSession } from '../auth/service'
import type { RouteDeps } from '../deps'

const loginBody = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 300 },
    password: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const

const refreshBody = {
  type: 'object',
  required: ['refreshToken'],
  additionalProperties: false,
  properties: { refreshToken: { type: 'string', minLength: 1, maxLength: 200 } },
} as const

export const authRoutes: FastifyPluginAsync<RouteDeps> = async (app, deps) => {
  app.post<{ Body: { email: string; password: string } }>(
    '/auth/login',
    { schema: { body: loginBody } },
    async (req) => login(deps, req.body.email, req.body.password),
  )

  app.post<{ Body: { refreshToken: string } }>(
    '/auth/refresh',
    { schema: { body: refreshBody } },
    async (req) => refreshSession(deps, req.body.refreshToken),
  )

  app.post<{ Body: { refreshToken: string } }>(
    '/auth/logout',
    { schema: { body: refreshBody } },
    async (req, reply) => {
      await logout(deps, req.body.refreshToken)
      return reply.code(204).send()
    },
  )
}
