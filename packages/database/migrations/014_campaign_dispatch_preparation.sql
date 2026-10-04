CREATE TABLE campaign_dispatch_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  message_version_id uuid NOT NULL,
  audience_list_id uuid NOT NULL,
  agent_id text NOT NULL,
  credential_version text NOT NULL,
  not_before timestamptz,
  prepared_by_user_id uuid NOT NULL REFERENCES users(id),
  prepared_revision integer NOT NULL CHECK (prepared_revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,id,campaign_id),
  UNIQUE (workspace_id,campaign_id),
  FOREIGN KEY (workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id),
  FOREIGN KEY (workspace_id,connection_id) REFERENCES provider_connections(workspace_id,id),
  FOREIGN KEY (workspace_id,message_version_id) REFERENCES message_versions(workspace_id,id),
  FOREIGN KEY (workspace_id,audience_list_id) REFERENCES contact_lists(workspace_id,id)
);
CREATE TABLE campaign_dispatch_recipients (
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  phone_normalized text NOT NULL CHECK (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  disposition text NOT NULL CHECK (disposition IN ('eligible','suppressed','unavailable')),
  PRIMARY KEY (workspace_id,run_id,contact_id),
  UNIQUE (workspace_id,campaign_id,contact_id),
  FOREIGN KEY (workspace_id,run_id,campaign_id) REFERENCES campaign_dispatch_runs(workspace_id,id,campaign_id),
  FOREIGN KEY (workspace_id,contact_id) REFERENCES contacts(workspace_id,id)
);
CREATE TABLE campaign_dispatch_confirmations (
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  campaign_revision integer NOT NULL CHECK (campaign_revision>0),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,run_id),
  FOREIGN KEY (workspace_id,run_id,campaign_id) REFERENCES campaign_dispatch_runs(workspace_id,id,campaign_id)
);
CREATE FUNCTION protect_dispatch_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'dispatch snapshot is immutable';
END $$;
CREATE TRIGGER dispatch_run_immutable BEFORE UPDATE OR DELETE ON campaign_dispatch_runs FOR EACH ROW EXECUTE FUNCTION protect_dispatch_snapshot();
CREATE TRIGGER dispatch_recipient_immutable BEFORE UPDATE OR DELETE ON campaign_dispatch_recipients FOR EACH ROW EXECUTE FUNCTION protect_dispatch_snapshot();
CREATE TRIGGER dispatch_confirmation_immutable BEFORE UPDATE OR DELETE ON campaign_dispatch_confirmations FOR EACH ROW EXECUTE FUNCTION protect_dispatch_snapshot();
CREATE FUNCTION guard_dispatch_snapshot_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE campaign_state text; campaign_mode text;
BEGIN
  SELECT status,execution_mode INTO campaign_state,campaign_mode FROM campaigns WHERE workspace_id=NEW.workspace_id AND id=NEW.campaign_id FOR UPDATE;
  IF TG_TABLE_NAME='campaign_dispatch_confirmations' THEN
    IF campaign_state<>'ready' OR campaign_mode IS DISTINCT FROM 'dispatch' THEN RAISE EXCEPTION 'dispatch preparation required'; END IF;
  ELSIF campaign_state IS DISTINCT FROM 'draft' OR campaign_mode IS NOT NULL THEN
    RAISE EXCEPTION 'dispatch snapshot requires draft';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dispatch_run_insert BEFORE INSERT ON campaign_dispatch_runs FOR EACH ROW EXECUTE FUNCTION guard_dispatch_snapshot_insert();
CREATE TRIGGER dispatch_recipient_insert BEFORE INSERT ON campaign_dispatch_recipients FOR EACH ROW EXECUTE FUNCTION guard_dispatch_snapshot_insert();
CREATE TRIGGER dispatch_confirmation_insert BEFORE INSERT ON campaign_dispatch_confirmations FOR EACH ROW EXECUTE FUNCTION guard_dispatch_snapshot_insert();
CREATE FUNCTION guard_dispatch_reservation_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM campaign_dispatch_runs r
    JOIN campaign_dispatch_confirmations f ON f.workspace_id=r.workspace_id AND f.run_id=r.id
    JOIN campaign_dispatch_recipients c ON c.workspace_id=r.workspace_id AND c.run_id=r.id
    WHERE r.workspace_id=NEW.workspace_id AND r.campaign_id=NEW.campaign_id AND c.contact_id=NEW.contact_id
      AND c.disposition='eligible' AND c.phone_normalized=NEW.phone_normalized
      AND r.connection_id=NEW.connection_id AND r.message_version_id=NEW.message_version_id
      AND r.agent_id=NEW.agent_id AND r.credential_version=NEW.credential_version
  ) THEN RAISE EXCEPTION 'confirmed dispatch snapshot required'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dispatch_reservation_snapshot BEFORE INSERT ON campaign_dispatch_attempts FOR EACH ROW EXECUTE FUNCTION guard_dispatch_reservation_snapshot();
