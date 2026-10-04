CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100 AND name !~ '^\s*$'),
  mime_type text NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 2097152),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 4096),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,id)
);
CREATE INDEX media_assets_workspace_idx ON media_assets (workspace_id,created_at,id);
-- Initial bounded private storage; provider-facing publication is a separate concern.
CREATE TABLE media_contents (
  workspace_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 2097152),
  PRIMARY KEY (workspace_id,asset_id),
  FOREIGN KEY (workspace_id,asset_id) REFERENCES media_assets(workspace_id,id) ON DELETE CASCADE
);
