import { DEFAULT_AGENT_CONFIG, withAgentDefaults, type Db } from '@helpix/shared'
import type { AgentConfig, AgentConfigState, TenantStatus } from '@helpix/shared/api-types'

interface ConfigRow {
  draft: Partial<AgentConfig>
  published: Partial<AgentConfig> | null
  draft_updated_at: Date
  published_at: Date | null
}

const COLUMNS = 'draft, published, draft_updated_at, published_at'

function toState(row: ConfigRow | undefined): AgentConfigState {
  if (!row) return { draft: withAgentDefaults(null), published: null, draftUpdatedAt: null, publishedAt: null }
  return {
    draft: withAgentDefaults(row.draft),
    published: row.published ? withAgentDefaults(row.published) : null,
    draftUpdatedAt: row.draft_updated_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
  }
}

export async function getAgentConfigState(db: Db, tenantId: string): Promise<AgentConfigState> {
  const { rows } = await db.query<ConfigRow>(`SELECT ${COLUMNS} FROM tenant_auth.agent_configs WHERE tenant_id = $1`, [tenantId])
  return toState(rows[0])
}

export async function saveDraft(db: Db, tenantId: string, config: AgentConfig): Promise<AgentConfigState> {
  const { rows } = await db.query<ConfigRow>(
    `INSERT INTO tenant_auth.agent_configs (tenant_id, draft) VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET draft = EXCLUDED.draft, draft_updated_at = now()
     RETURNING ${COLUMNS}`,
    [tenantId, JSON.stringify(config)],
  )
  return toState(rows[0])
}

/** Copies the saved draft to the published config. A tenant that never saved a draft publishes the defaults. */
export async function publishDraft(db: Db, tenantId: string): Promise<AgentConfigState> {
  const { rows } = await db.query<ConfigRow>(
    `INSERT INTO tenant_auth.agent_configs (tenant_id, draft, published, published_at) VALUES ($1, $2, $2, now())
     ON CONFLICT (tenant_id) DO UPDATE SET published = agent_configs.draft, published_at = now()
     RETURNING ${COLUMNS}`,
    [tenantId, JSON.stringify(DEFAULT_AGENT_CONFIG)],
  )
  return toState(rows[0])
}

/**
 * What the live agent runs on: the published config (defaults before the first publish), the shop's name, and
 * whether order lookup is available (an order API URL and key are stored).
 */
export async function getPublishedConfig(
  db: Db,
  tenantId: string,
): Promise<{ tenantName: string; status: TenantStatus; config: AgentConfig; orderLookup: boolean } | null> {
  const { rows } = await db.query<{ name: string; status: TenantStatus; published: Partial<AgentConfig> | null; order_lookup: boolean }>(
    `SELECT t.name, t.status, c.published,
            (i.order_api_base_url IS NOT NULL AND i.order_api_key_enc IS NOT NULL) AS order_lookup
       FROM tenant_auth.tenants t
       LEFT JOIN tenant_auth.agent_configs c ON c.tenant_id = t.id
       LEFT JOIN tenant_auth.integrations i ON i.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId],
  )
  const r = rows[0]
  return r ? { tenantName: r.name, status: r.status, config: withAgentDefaults(r.published), orderLookup: r.order_lookup === true } : null
}
