CREATE TABLE eligibility_checks (
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  credential_version text NOT NULL,
  attempt_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('eligible','ineligible','unknown','blocked')),
  reason text NOT NULL CHECK (reason IN ('checking','provider_checked','unsupported','provider_unavailable','opted_out','connection_unavailable')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, connection_id, contact_id),
  FOREIGN KEY (workspace_id, connection_id) REFERENCES provider_connections(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts(workspace_id,id) ON DELETE CASCADE,
  CHECK (expires_at > checked_at)
);
