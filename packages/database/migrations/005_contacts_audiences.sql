CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  phone_normalized text NOT NULL CHECK (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  name text NOT NULL DEFAULT '' CHECK (length(name) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, phone_normalized), UNIQUE (workspace_id, id)
);
CREATE TABLE contact_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100 AND name !~ '^\s*$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE TABLE contact_list_members (
  workspace_id uuid NOT NULL,
  list_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, list_id, contact_id),
  FOREIGN KEY (workspace_id, list_id) REFERENCES contact_lists(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts(workspace_id, id) ON DELETE CASCADE
);
CREATE TABLE opt_outs (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  phone_normalized text NOT NULL CHECK (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, phone_normalized)
);
