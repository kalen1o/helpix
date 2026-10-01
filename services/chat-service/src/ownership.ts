import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { AppError, type Db } from '@helpix/shared'
import { createConversation, findConversation, type ConversationRow } from './repos/conversations'

/** Who is asking on the customer route: a verified shop customer (gateway header) or an anonymous visitor. */
export type Requester = { kind: 'customer'; customerId: string } | { kind: 'anonymous'; sessionToken: string | null }

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Unknown, foreign-tenant, other-owner and wrong-kind conversations all look the same, so ids cannot be probed.
const notFound = () => new AppError(404, 'conversation_not_found', 'Conversation not found')

function owns(row: ConversationRow, requester: Requester): boolean {
  if (requester.kind === 'customer') return row.customer_id === requester.customerId
  if (!requester.sessionToken || !row.session_token_hash) return false
  return timingSafeEqual(Buffer.from(hashSessionToken(requester.sessionToken)), Buffer.from(row.session_token_hash))
}

/**
 * Spec §3.2. Returns the requester's conversation, or creates one when `conversationId` is null. `sessionToken` is
 * returned only for a newly created anonymous conversation; the widget stores it and sends it with later messages.
 */
export async function openConversation(
  db: Db,
  input: { tenantId: string; conversationId: string | null; requester: Requester },
): Promise<{ conversation: ConversationRow; sessionToken: string | null }> {
  const { tenantId, conversationId, requester } = input
  if (conversationId === null) {
    if (requester.kind === 'customer') {
      const conversation = await createConversation(db, { tenantId, isPlayground: false, customerId: requester.customerId, sessionTokenHash: null })
      return { conversation, sessionToken: null }
    }
    const sessionToken = newSessionToken()
    const conversation = await createConversation(db, {
      tenantId,
      isPlayground: false,
      customerId: null,
      sessionTokenHash: hashSessionToken(sessionToken),
    })
    return { conversation, sessionToken }
  }
  const row = await findConversation(db, tenantId, conversationId, false)
  if (!row || !owns(row, requester)) throw notFound()
  return { conversation: row, sessionToken: null }
}

/** Playground conversations belong to the tenant (any of its admins may continue one). */
export async function openPlaygroundConversation(
  db: Db,
  input: { tenantId: string; conversationId: string | null; customerId: string | null },
): Promise<ConversationRow> {
  if (input.conversationId === null) {
    return createConversation(db, { tenantId: input.tenantId, isPlayground: true, customerId: input.customerId, sessionTokenHash: null })
  }
  const row = await findConversation(db, input.tenantId, input.conversationId, true)
  if (!row) throw notFound()
  return row
}
