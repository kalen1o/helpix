CREATE TABLE chat.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  is_playground boolean NOT NULL DEFAULT false,
  -- Owner (spec §3.2): a logged-in shopper's customer id, or the SHA-256 hash of an anonymous visitor's session token.
  -- Playground conversations belong to the tenant's admins and may carry a test customer id.
  customer_id text CHECK (length(customer_id) BETWEEN 1 AND 200),
  session_token_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Target of the messages foreign key, so a message's tenant must equal its conversation's tenant.
  UNIQUE (id, tenant_id),
  CHECK (
    (is_playground AND session_token_hash IS NULL)
    OR (NOT is_playground AND (customer_id IS NULL) <> (session_token_hash IS NULL))
  )
);
CREATE INDEX conversations_tenant_list_idx ON chat.conversations (tenant_id, is_playground, updated_at DESC);

CREATE TABLE chat.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Both messages of a turn are written in one transaction, so created_at ties; seq gives the order.
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  -- ToolActivity[] for an assistant reply. With order lookups (step 4) this is the only place order data is kept.
  tools jsonb NOT NULL DEFAULT '[]',
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, tenant_id) REFERENCES chat.conversations (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX messages_conversation_seq_idx ON chat.messages (conversation_id, seq);
