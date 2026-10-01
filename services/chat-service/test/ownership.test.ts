import { AppError, type Db } from '@helpix/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashSessionToken, newSessionToken, openConversation, openPlaygroundConversation, type Requester } from '../src/ownership'
import { resetDb, setupTestDb, TENANT_A, TENANT_B } from './helpers'

let db: Db
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => { await resetDb(db) })

const customer = (customerId: string): Requester => ({ kind: 'customer', customerId })
const anonymous = (sessionToken: string | null): Requester => ({ kind: 'anonymous', sessionToken })
const open = (requester: Requester, conversationId: string | null = null, tenantId = TENANT_A) =>
  openConversation(db, { tenantId, conversationId, requester })

async function expectNotFound(p: Promise<unknown>) {
  const err = await p.catch((e) => e)
  expect(err).toBeInstanceOf(AppError)
  expect(err).toMatchObject({ status: 404, code: 'conversation_not_found', message: 'Conversation not found' })
}

describe('session tokens', () => {
  it('are random and URL-safe, and only their SHA-256 hash is kept', () => {
    const a = newSessionToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newSessionToken()).not.toBe(a)
    expect(hashSessionToken(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSessionToken(a)).toBe(hashSessionToken(a))
  })
})

describe('openConversation', () => {
  it('creates an anonymous conversation and hands out its token once', async () => {
    const first = await open(anonymous(null))
    expect(first.sessionToken).toEqual(expect.any(String))
    expect(first.conversation).toMatchObject({ tenant_id: TENANT_A, is_playground: false, customer_id: null })
    expect(first.conversation.session_token_hash).toBe(hashSessionToken(first.sessionToken!))

    const again = await open(anonymous(first.sessionToken), first.conversation.id)
    expect(again.conversation.id).toBe(first.conversation.id)
    expect(again.sessionToken).toBeNull()
  })

  it('creates a customer conversation without a token', async () => {
    const first = await open(customer('cust-1'))
    expect(first.sessionToken).toBeNull()
    expect(first.conversation).toMatchObject({ customer_id: 'cust-1', session_token_hash: null })
    expect((await open(customer('cust-1'), first.conversation.id)).conversation.id).toBe(first.conversation.id)
  })

  it('hides an anonymous conversation from a wrong, missing or customer requester', async () => {
    const { conversation } = await open(anonymous(null))
    await expectNotFound(open(anonymous(newSessionToken()), conversation.id))
    await expectNotFound(open(anonymous(null), conversation.id))
    await expectNotFound(open(customer('cust-1'), conversation.id))
  })

  it("hides a customer conversation from another customer and from anonymous visitors", async () => {
    const { conversation } = await open(customer('cust-1'))
    await expectNotFound(open(customer('cust-2'), conversation.id))
    await expectNotFound(open(anonymous(newSessionToken()), conversation.id))
  })

  it('hides another tenant\'s conversation even with the right token', async () => {
    const first = await open(anonymous(null))
    await expectNotFound(open(anonymous(first.sessionToken), first.conversation.id, TENANT_B))
  })

  it('hides playground conversations from the customer route', async () => {
    const pg = await openPlaygroundConversation(db, { tenantId: TENANT_A, conversationId: null, customerId: 'cust-1' })
    await expectNotFound(open(customer('cust-1'), pg.id))
  })

  it('answers an unknown id exactly like a foreign one', async () => {
    await expectNotFound(open(customer('cust-1'), '00000000-0000-4000-8000-000000000999'))
  })
})

describe('openPlaygroundConversation', () => {
  it('creates and continues a playground conversation with an optional test customer', async () => {
    const pg = await openPlaygroundConversation(db, { tenantId: TENANT_A, conversationId: null, customerId: 'test-1' })
    expect(pg).toMatchObject({ is_playground: true, customer_id: 'test-1', session_token_hash: null })
    const again = await openPlaygroundConversation(db, { tenantId: TENANT_A, conversationId: pg.id, customerId: null })
    expect(again.id).toBe(pg.id)
  })

  it('cannot continue a real conversation or another tenant\'s playground', async () => {
    const real = await open(anonymous(null))
    await expectNotFound(openPlaygroundConversation(db, { tenantId: TENANT_A, conversationId: real.conversation.id, customerId: null }))
    const pg = await openPlaygroundConversation(db, { tenantId: TENANT_A, conversationId: null, customerId: null })
    await expectNotFound(openPlaygroundConversation(db, { tenantId: TENANT_B, conversationId: pg.id, customerId: null }))
  })
})
