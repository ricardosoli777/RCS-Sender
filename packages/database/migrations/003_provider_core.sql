CREATE TABLE provider_connections (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  provider_id text NOT NULL CHECK (provider_id ~ '^[a-z][a-z0-9_]{1,63}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  environment text NOT NULL CHECK (length(environment) BETWEEN 1 AND 64),
  status text NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'connected', 'disconnected', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE INDEX provider_connections_workspace_idx ON provider_connections (workspace_id, created_at);
CREATE TABLE provider_credentials (
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, connection_id),
  FOREIGN KEY (workspace_id, connection_id) REFERENCES provider_connections(workspace_id, id) ON DELETE CASCADE
);
