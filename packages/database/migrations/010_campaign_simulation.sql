ALTER TABLE campaigns ADD COLUMN execution_mode text CHECK (execution_mode='simulation');
CREATE TABLE campaign_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode='simulation'),
  message_version_id uuid NOT NULL,
  not_before timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,id), UNIQUE (workspace_id,campaign_id),
  FOREIGN KEY (workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id),
  FOREIGN KEY (workspace_id,message_version_id) REFERENCES message_versions(workspace_id,id)
);
CREATE TABLE campaign_recipients (
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  phone_normalized text NOT NULL CHECK (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  status text NOT NULL CHECK (status IN ('pending','simulated','suppressed','cancelled')),
  simulation_result_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,run_id,contact_id), UNIQUE (workspace_id,run_id,phone_normalized),
  FOREIGN KEY (workspace_id,run_id) REFERENCES campaign_runs(workspace_id,id),
  FOREIGN KEY (workspace_id,contact_id) REFERENCES contacts(workspace_id,id),
  CHECK ((status='simulated' AND simulation_result_id IS NOT NULL) OR (status<>'simulated' AND simulation_result_id IS NULL))
);
CREATE INDEX campaign_recipients_pending_idx ON campaign_recipients(workspace_id,run_id,status,contact_id);
CREATE FUNCTION protect_campaign_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'campaign run snapshot is immutable'; END $$;
CREATE TRIGGER campaign_runs_immutable BEFORE UPDATE OR DELETE ON campaign_runs FOR EACH ROW EXECUTE FUNCTION protect_campaign_run();
CREATE FUNCTION protect_campaign_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'campaign recipient snapshot cannot be deleted'; END IF;
  IF ROW(NEW.workspace_id,NEW.run_id,NEW.contact_id,NEW.phone_normalized) IS DISTINCT FROM ROW(OLD.workspace_id,OLD.run_id,OLD.contact_id,OLD.phone_normalized) THEN
    RAISE EXCEPTION 'campaign recipient identity is immutable';
  END IF;
  IF OLD.status<>'pending' AND ROW(NEW.status,NEW.simulation_result_id) IS DISTINCT FROM ROW(OLD.status,OLD.simulation_result_id) THEN
    RAISE EXCEPTION 'campaign recipient result is final';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaign_recipients_guard BEFORE UPDATE OR DELETE ON campaign_recipients FOR EACH ROW EXECUTE FUNCTION protect_campaign_recipient();
CREATE FUNCTION guard_campaign_recipient_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM campaign_runs r JOIN campaigns c ON c.workspace_id=r.workspace_id AND c.id=r.campaign_id WHERE r.workspace_id=NEW.workspace_id AND r.id=NEW.run_id AND c.status='draft') THEN
    RAISE EXCEPTION 'campaign audience is frozen';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaign_recipients_insert_guard BEFORE INSERT ON campaign_recipients FOR EACH ROW EXECUTE FUNCTION guard_campaign_recipient_insert();
CREATE OR REPLACE FUNCTION protect_campaign_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN RAISE EXCEPTION 'campaign identity is immutable'; END IF;
  IF OLD.status<>'draft' AND ROW(NEW.name,NEW.objective,NEW.provider_connection_id,NEW.agent_id,NEW.audience_list_id,NEW.message_version_id,NEW.scheduled_at,NEW.execution_mode)
    IS DISTINCT FROM ROW(OLD.name,OLD.objective,OLD.provider_connection_id,OLD.agent_id,OLD.audience_list_id,OLD.message_version_id,OLD.scheduled_at,OLD.execution_mode) THEN
    RAISE EXCEPTION 'campaign configuration is frozen';
  END IF;
  RETURN NEW;
END $$;
