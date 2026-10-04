CREATE TABLE messages (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100 AND name !~ '^\s*$'),
  purpose text NOT NULL CHECK (purpose IN ('marketing','transactional','authentication')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  active_version integer,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,id),
  CHECK ((status='active' AND active_version IS NOT NULL AND active_version > 0 AND active_version <= current_version)
    OR (status<>'active' AND active_version IS NULL))
);
CREATE INDEX messages_workspace_idx ON messages(workspace_id,created_at,id);
CREATE TABLE message_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  message_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  purpose text NOT NULL CHECK (purpose IN ('marketing','transactional','authentication')),
  content jsonb NOT NULL CHECK (jsonb_typeof(content)='object' AND content ? 'type' AND content->>'type' IN ('text','rich_card')),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,id), UNIQUE (workspace_id,message_id,version),
  FOREIGN KEY (workspace_id,message_id) REFERENCES messages(workspace_id,id)
);
ALTER TABLE messages ADD CONSTRAINT messages_current_version_fk FOREIGN KEY (workspace_id,id,current_version)
  REFERENCES message_versions(workspace_id,message_id,version) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE messages ADD CONSTRAINT messages_active_version_fk FOREIGN KEY (workspace_id,id,active_version)
  REFERENCES message_versions(workspace_id,message_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE message_version_media (
  workspace_id uuid NOT NULL,
  version_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  PRIMARY KEY (workspace_id,version_id,asset_id),
  FOREIGN KEY (workspace_id,version_id) REFERENCES message_versions(workspace_id,id),
  FOREIGN KEY (workspace_id,asset_id) REFERENCES media_assets(workspace_id,id)
);
CREATE FUNCTION protect_message_versions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'message versions are immutable'; END $$;
CREATE TRIGGER message_versions_immutable BEFORE UPDATE OR DELETE ON message_versions
  FOR EACH ROW EXECUTE FUNCTION protect_message_versions();
