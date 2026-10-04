ALTER TABLE provider_connections ADD COLUMN dispatch_interval_ms integer NOT NULL DEFAULT 1000 CHECK(dispatch_interval_ms BETWEEN 1000 AND 60000);
CREATE TABLE connection_dispatch_windows (
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  next_available_at timestamptz NOT NULL,
  PRIMARY KEY(workspace_id,connection_id),
  FOREIGN KEY(workspace_id,connection_id) REFERENCES provider_connections(workspace_id,id)
);
