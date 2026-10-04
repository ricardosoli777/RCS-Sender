CREATE TABLE dispatch_correlations (
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  provider_message_id text NOT NULL CHECK(length(provider_message_id) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,attempt_id),
  UNIQUE(workspace_id,connection_id,provider_message_id),
  FOREIGN KEY(workspace_id,attempt_id) REFERENCES campaign_dispatch_attempts(workspace_id,id),
  FOREIGN KEY(workspace_id,connection_id) REFERENCES provider_connections(workspace_id,id)
);
CREATE TRIGGER dispatch_correlation_guard BEFORE UPDATE OR DELETE ON dispatch_correlations FOR EACH ROW EXECUTE FUNCTION protect_canonical_event();
