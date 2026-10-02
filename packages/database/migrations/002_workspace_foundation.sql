ALTER TABLE users ADD COLUMN name text;
UPDATE users SET name = split_part(email, '@', 1);
ALTER TABLE users ALTER COLUMN name SET NOT NULL;
ALTER TABLE users ADD COLUMN status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'disabled'));
UPDATE users SET status = 'disabled' WHERE disabled_at IS NOT NULL;

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members (user_id, status);

-- Preserve existing users and create their initial owner memberships.
INSERT INTO workspaces (name, slug, created_by_user_id)
  SELECT 'Workspace de ' || left(name, 80), 'workspace-' || id::text, id FROM users;
INSERT INTO workspace_members (workspace_id, user_id, role)
  SELECT id, created_by_user_id, 'owner' FROM workspaces;

-- Authentication events have system scope (e.g. an unknown account).
-- Preserve the initial log without assigning invented workspace ownership.
ALTER TABLE audit_logs RENAME TO auth_audit_logs;

CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event text NOT NULL,
  entity_type text,
  entity_id text,
  timestamp timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_logs_workspace_idx ON audit_logs (workspace_id, id DESC);
