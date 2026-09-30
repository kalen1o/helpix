import { timingSafeEqual } from 'node:crypto'
import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify'
import { AppError, errorBody } from './errors'
import { HEADERS } from './headers'

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send(errorBody(err.code, err.message, req.id))
    }
    if (err.validation) {
      return reply.code(400).send(errorBody('validation_error', err.message, req.id))
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send(errorBody('bad_request', err.message, req.id))
    }
    req.log.error(err)
    return reply.code(500).send(errorBody('internal_error', 'Internal server error', req.id))
  })
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send(errorBody('not_found', 'Route not found', req.id))
  })
}

export function requireInternalToken(expected: string) {
  const expectedBuf = Buffer.from(expected)
  return async (req: FastifyRequest): Promise<void> => {
    const got = req.headers[HEADERS.internalToken]
    const gotBuf = Buffer.from(typeof got === 'string' ? got : '')
    if (gotBuf.length !== expectedBuf.length || !timingSafeEqual(gotBuf, expectedBuf)) {
      throw new AppError(401, 'unauthorized', 'Missing or invalid internal token')
    }
  }
}
