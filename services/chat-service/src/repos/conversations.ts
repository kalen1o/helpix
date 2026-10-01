import type { Db } from '@helpix/shared'
import type { ConversationListResponse, ConversationSummary } from '@helpix/shared/api-types'

export interface ConversationRow {
  id: string
  tenant_id: string
  is_playground: boolean
  customer_id: string | null
  session_token_hash: string | null
  created_at: Date
  updated_at: Date
}

const COLUMNS = 'id, tenant_id, is_playground, customer_id, session_token_hash, created_at, updated_at'

export async function createConversation(
  db: Db,
  input: { tenantId: string; isPlayground: boolean; customerId: string | null; sessionTokenHash: string | null },
): Promise<ConversationRow> {
  const { rows } = await db.query<ConversationRow>(
    `INSERT INTO chat.conversations (tenant_id, is_playground, customer_id, session_token_hash)
     VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
    [input.tenantId, input.isPlayground, input.customerId, input.sessionTokenHash],
  )
  return rows[0]!
}

/** A conversation of this tenant and kind (real or playground), or null. */
export async function findConversation(db: Db, tenantId: string, id: string, isPlayground: boolean): Promise<ConversationRow | null> {
  const { rows } = await db.query<ConversationRow>(
    `SELECT ${COLUMNS} FROM chat.conversations WHERE id = $1 AND tenant_id = $2 AND is_playground = $3`,
    [id, tenantId, isPlayground],
  )
  return rows[0] ?? null
}

interface SummaryRow {
  id: string
  is_playground: boolean
  customer_id: string | null
  message_count: number
  preview: string | null
  created_at: Date
  updated_at: Date
  /** updated_at at full microsecond precision, for paging; an ISO string would round it to milliseconds. */
  cursor: string
}

// The inner join leaves out conversations with no messages (a first turn that failed before it was stored).
const SUMMARY_SELECT = `
  SELECT c.id, c.is_playground, c.customer_id, c.created_at, c.updated_at,
         count(m.id)::int AS message_count,
         (array_agg(m.content ORDER BY m.seq) FILTER (WHERE m.role = 'user'))[1] AS preview,
         to_char(c.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor
    FROM chat.conversations c
    JOIN chat.messages m ON m.conversation_id = c.id AND m.tenant_id = c.tenant_id`

function toSummary(r: SummaryRow): ConversationSummary {
  return {
    id: r.id,
    isPlayground: r.is_playground,
    customerId: r.customer_id,
    messageCount: r.message_count,
    preview: r.preview ?? '',
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }
}

export async function listConversations(
  db: Db,
  tenantId: string,
  opts: { playground: boolean; before: string | null; limit: number },
): Promise<ConversationListResponse> {
  const { rows } = await db.query<SummaryRow>(
    `${SUMMARY_SELECT}
     WHERE c.tenant_id = $1 AND c.is_playground = $2 AND ($3::timestamptz IS NULL OR c.updated_at < $3::timestamptz)
     GROUP BY c.id
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT $4`,
    [tenantId, opts.playground, opts.before, opts.limit],
  )
  return {
    conversations: rows.map(toSummary),
    nextBefore: rows.length === opts.limit ? rows[rows.length - 1]!.cursor : null,
  }
}

export async function getConversationSummary(db: Db, tenantId: string, id: string): Promise<ConversationSummary | null> {
  const { rows } = await db.query<SummaryRow>(`${SUMMARY_SELECT} WHERE c.tenant_id = $1 AND c.id = $2 GROUP BY c.id`, [tenantId, id])
  return rows[0] ? toSummary(rows[0]) : null
}
