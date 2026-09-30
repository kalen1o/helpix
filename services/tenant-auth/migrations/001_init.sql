CREATE TABLE tenant_auth.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  widget_key text NOT NULL UNIQUE,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_auth.admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenant_auth.tenants(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('super_admin', 'tenant_admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'super_admin') = (tenant_id IS NULL))
);
CREATE INDEX admins_tenant_id_idx ON tenant_auth.admins (tenant_id);

CREATE TABLE tenant_auth.refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES tenant_auth.admins(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
