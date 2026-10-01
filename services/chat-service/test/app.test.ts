import type { Db } from '@helpix/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTestApp, internalHeaders, makeDeps, setupTestDb } from './helpers'

let db: Db
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })

describe('chat-service app', () => {
  it('requires the internal token', async () => {
    const app = await buildTestApp(makeDeps(db))
    expect((await app.inject({ method: 'GET', url: '/chat/health' })).statusCode).toBe(401)
    const ok = await app.inject({ method: 'GET', url: '/chat/health', headers: internalHeaders() })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ ok: true })
    await app.close()
  })
})
