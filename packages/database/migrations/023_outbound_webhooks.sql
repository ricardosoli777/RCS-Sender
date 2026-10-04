CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  active_version integer NOT NULL DEFAULT 1 CHECK(active_version>0),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id)
);
CREATE TABLE webhook_endpoint_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  endpoint_id uuid NOT NULL,
  version integer NOT NULL CHECK(version>0),
  config_ciphertext text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),UNIQUE(workspace_id,endpoint_id,version),
  FOREIGN KEY(workspace_id,endpoint_id) REFERENCES webhook_endpoints(workspace_id,id)
);
ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoint_version_fk FOREIGN KEY(workspace_id,id,active_version) REFERENCES webhook_endpoint_versions(workspace_id,endpoint_id,version) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE journey_nodes ADD COLUMN webhook_endpoint_version_id uuid;
ALTER TABLE journey_nodes ADD CONSTRAINT journey_node_webhook_version_fk FOREIGN KEY(workspace_id,webhook_endpoint_version_id) REFERENCES webhook_endpoint_versions(workspace_id,id);
CREATE TRIGGER webhook_endpoint_versions_immutable BEFORE UPDATE OR DELETE ON webhook_endpoint_versions FOR EACH ROW EXECUTE FUNCTION protect_canonical_event();
CREATE TABLE journey_webhook_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  node_id text NOT NULL,
  endpoint_version_id uuid NOT NULL,
  payload_ciphertext text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','rejected','unknown','cancelled')),
  http_status integer CHECK(http_status BETWEEN 100 AND 599),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),UNIQUE(workspace_id,enrollment_id,node_id),
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES journey_enrollments(workspace_id,id),
  FOREIGN KEY(workspace_id,endpoint_version_id) REFERENCES webhook_endpoint_versions(workspace_id,id)
);
CREATE INDEX journey_webhooks_due ON journey_webhook_actions(workspace_id,status,updated_at);
CREATE FUNCTION protect_journey_webhook_action() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR ROW(NEW.id,NEW.workspace_id,NEW.enrollment_id,NEW.node_id,NEW.endpoint_version_id,NEW.payload_ciphertext,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.enrollment_id,OLD.node_id,OLD.endpoint_version_id,OLD.payload_ciphertext,OLD.created_at) OR (OLD.status IN ('accepted','rejected','unknown','cancelled') AND NEW IS DISTINCT FROM OLD) OR (OLD.status='sending' AND NEW.status='pending') THEN RAISE EXCEPTION 'webhook attempt is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journey_webhook_actions_guard BEFORE UPDATE OR DELETE ON journey_webhook_actions FOR EACH ROW EXECUTE FUNCTION protect_journey_webhook_action();
