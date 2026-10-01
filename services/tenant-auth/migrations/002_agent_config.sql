-- Agent settings per tenant (spec §2.1, §3.7). Admins edit `draft`; publishing copies it to `published`, which the
-- live agent uses. Both hold an AgentConfig as JSON; fields missing from an older row take defaults when read.
CREATE TABLE tenant_auth.agent_configs (
  tenant_id uuid PRIMARY KEY REFERENCES tenant_auth.tenants(id) ON DELETE CASCADE,
  draft jsonb NOT NULL,
  published jsonb,
  draft_updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK ((published IS NULL) = (published_at IS NULL))
);
