import type { Db } from '@helpix/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { internalHeaders, makeDeps, setupTestDb, tempDir } from './helpers'

let db: Db
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })

describe('kb-service app', () => {
  it('requires the internal token on every route', async () => {
    const app = await buildApp(makeDeps(db, await tempDir()))
    const res = await app.inject({ method: 'GET', url: '/kb/health' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthorized')
    expect((await app.inject({ method: 'GET', url: '/kb/health', headers: internalHeaders() })).json()).toEqual({ ok: true })
    await app.close()
  })

  it('echoes the gateway request id in errors', async () => {
    const app = await buildApp(makeDeps(db, await tempDir()))
    const res = await app.inject({ method: 'GET', url: '/kb/nope', headers: { ...internalHeaders(), 'x-request-id': 'req-123' } })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.requestId).toBe('req-123')
    await app.close()
  })
})
