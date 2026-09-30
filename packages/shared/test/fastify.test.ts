import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { AppError, HEADERS, registerErrorHandler, requireInternalToken } from '../src/index'

function buildApp() {
  const app = Fastify({ requestIdHeader: HEADERS.requestId })
  registerErrorHandler(app)
  app.get('/conflict', async () => {
    throw new AppError(409, 'slug_taken', 'Slug already in use')
  })
  app.get('/boom', async () => {
    throw new Error('database password is hunter2')
  })
  app.post('/validated', {
    schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
  }, async () => ({ ok: true }))
  return app
}

describe('registerErrorHandler', () => {
  it('maps AppError to its status and the standard error shape', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/conflict', headers: { [HEADERS.requestId]: 'req-1' } })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: { code: 'slug_taken', message: 'Slug already in use', requestId: 'req-1' } })
  })

  it('hides the message of unexpected errors', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe('internal_error')
    expect(res.body).not.toContain('hunter2')
  })

  it('maps schema validation failures to 400 validation_error', async () => {
    const res = await buildApp().inject({ method: 'POST', url: '/validated', payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
  })

  it('returns the standard shape for unknown routes', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
  })
})

describe('requireInternalToken', () => {
  function appWithGuard() {
    const app = Fastify()
    registerErrorHandler(app)
    app.addHook('onRequest', requireInternalToken('secret-token'))
    app.get('/x', async () => ({ ok: true }))
    return app
  }

  it('rejects a missing token', async () => {
    const res = await appWithGuard().inject({ method: 'GET', url: '/x' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthorized')
  })

  it('rejects a wrong token of the same length', async () => {
    const res = await appWithGuard().inject({ method: 'GET', url: '/x', headers: { [HEADERS.internalToken]: 'secret-tokeX' } })
    expect(res.statusCode).toBe(401)
  })

  it('accepts the right token', async () => {
    const res = await appWithGuard().inject({ method: 'GET', url: '/x', headers: { [HEADERS.internalToken]: 'secret-token' } })
    expect(res.statusCode).toBe(200)
  })
})
