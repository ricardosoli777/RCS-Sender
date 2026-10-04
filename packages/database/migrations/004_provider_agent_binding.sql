-- Signed agent identity is reserved globally per provider, including test environments.
-- Existing unbound connections remain unverified until the adapter supplies an identity.
ALTER TABLE provider_connections ADD COLUMN external_agent_id text
  CHECK (external_agent_id IS NULL OR (length(external_agent_id) BETWEEN 1 AND 256 AND external_agent_id !~ '^\s*$'));
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_agent_unique UNIQUE (provider_id, external_agent_id);
