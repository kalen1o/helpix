import type { Db } from '@helpix/shared'
import type { ChatMessageView, ChatRole, ToolActivity } from '@helpix/shared/api-types'

/** The last `limit` messages, oldest first. */
export async function recentMessages(
  db: Db,
  tenantId: string,
  conversationId: string,
  limit: number,
): Promise<{ role: ChatRole; content: string }[]> {
  const { rows } = await db.query<{ role: ChatRole; content: string }>(
    `SELECT role, content FROM (
       SELECT role, content, seq FROM chat.messages
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY seq DESC LIMIT $3
     ) recent ORDER BY seq`,
    [tenantId, conversationId, limit],
  )
  return rows
}

/**
 * Stores a finished turn: the user's message and the assistant's reply, together (spec §3.1). A turn that fails is
 * never stored, so a retry does not leave a duplicate question in the history. Returns the assistant message id.
 */
export async function saveTurn(
  db: Db,
  input: { tenantId: string; conversationId: string; userText: string; assistantText: string; tools: ToolActivity[]; model: string },
): Promise<string> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query(`INSERT INTO chat.messages (tenant_id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`, [
      input.tenantId,
      input.conversationId,
      input.userText,
    ])
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO chat.messages (tenant_id, conversation_id, role, content, tools, model)
       VALUES ($1, $2, 'assistant', $3, $4, $5) RETURNING id`,
      [input.tenantId, input.conversationId, input.assistantText, JSON.stringify(input.tools), input.model],
    )
    await client.query(`UPDATE chat.conversations SET updated_at = now() WHERE id = $1 AND tenant_id = $2`, [
      input.conversationId,
      input.tenantId,
    ])
    await client.query('COMMIT')
    return rows[0]!.id
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

interface MessageRow {
  id: string
  role: ChatRole
  content: string
  tools: ToolActivity[]
  model: string | null
  created_at: Date
}

export async function listMessages(db: Db, tenantId: string, conversationId: string): Promise<ChatMessageView[]> {
  const { rows } = await db.query<MessageRow>(
    `SELECT id, role, content, tools, model, created_at FROM chat.messages
      WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY seq`,
    [tenantId, conversationId],
  )
  return rows.map((r) => ({ id: r.id, role: r.role, content: r.content, tools: r.tools, model: r.model, createdAt: r.created_at.toISOString() }))
}
