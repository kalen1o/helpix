-- Per-tenant integrations (4b spec §3.1): the shop's public key for shopper JWTs, and its order API.
-- order_api_key_enc is AES-256-GCM ciphertext ("v1:<iv>:<tag>:<ct>"); the plain key is never stored.
CREATE TABLE tenant_auth.integrations (
  tenant_id uuid PRIMARY KEY REFERENCES tenant_auth.tenants(id) ON DELETE CASCADE,
  shop_key_pem text CHECK (char_length(shop_key_pem) <= 10240),
  shop_key_fingerprint text,
  shop_key_updated_at timestamptz,
  order_api_base_url text CHECK (char_length(order_api_base_url) <= 500),
  order_api_key_enc text,
  order_api_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((shop_key_pem IS NULL) = (shop_key_fingerprint IS NULL) AND (shop_key_pem IS NULL) = (shop_key_updated_at IS NULL)),
  CHECK ((order_api_base_url IS NULL) = (order_api_key_enc IS NULL) AND (order_api_base_url IS NULL) = (order_api_updated_at IS NULL))
);
