-- init.sql already creates it; kept here so a fresh database without init.sql still works.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE kb.documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  error text,
  extracted_text text,
  embedding_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Target of the chunks foreign key, so a chunk's tenant must equal its document's tenant.
  UNIQUE (id, tenant_id)
);
CREATE INDEX documents_tenant_created_idx ON kb.documents (tenant_id, created_at DESC);

CREATE TABLE kb.chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  text text NOT NULL,
  embedding vector(1024) NOT NULL,
  embedding_model text NOT NULL,
  FOREIGN KEY (document_id, tenant_id) REFERENCES kb.documents (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (document_id, position)
);
CREATE INDEX chunks_tenant_model_idx ON kb.chunks (tenant_id, embedding_model);
CREATE INDEX chunks_embedding_hnsw_idx ON kb.chunks USING hnsw (embedding vector_cosine_ops);
