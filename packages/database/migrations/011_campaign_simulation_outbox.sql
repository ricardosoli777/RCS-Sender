CREATE TABLE campaign_simulation_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  expected_revision integer NOT NULL CHECK (expected_revision > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','discarded','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id,run_id) REFERENCES campaign_runs(workspace_id,id),
  UNIQUE (workspace_id,run_id,expected_revision)
);
CREATE UNIQUE INDEX campaign_simulation_one_pending ON campaign_simulation_outbox(workspace_id,run_id) WHERE status='pending';
CREATE INDEX campaign_simulation_outbox_due ON campaign_simulation_outbox(available_at,id) WHERE status='pending';
