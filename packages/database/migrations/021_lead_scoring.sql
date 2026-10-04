CREATE TABLE score_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  rules jsonb NOT NULL,
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(rules)='array')
);
