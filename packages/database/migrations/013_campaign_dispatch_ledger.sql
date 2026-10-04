ALTER TABLE campaigns DROP CONSTRAINT campaigns_execution_mode_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_execution_mode_check CHECK (execution_mode IN ('simulation','dispatch'));
CREATE TABLE campaign_dispatch_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  message_version_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  campaign_revision integer NOT NULL CHECK (campaign_revision>0),
  credential_version text NOT NULL,
  phone_normalized text NOT NULL CHECK (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  agent_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('sending','accepted','rejected','unknown')),
  provider_message_id text,
  error_code text CHECK (error_code IN ('invalid_credentials','invalid_message','unsupported_capability','rate_limited','unavailable','rejected','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,campaign_id,contact_id),
  FOREIGN KEY (workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id),
  FOREIGN KEY (workspace_id,contact_id) REFERENCES contacts(workspace_id,id),
  FOREIGN KEY (workspace_id,connection_id) REFERENCES provider_connections(workspace_id,id),
  FOREIGN KEY (workspace_id,message_version_id) REFERENCES message_versions(workspace_id,id),
  CHECK ((status='accepted' AND provider_message_id IS NOT NULL AND error_code IS NULL) OR (status<>'accepted' AND provider_message_id IS NULL)),
  CHECK (status NOT IN ('rejected','unknown') OR error_code IS NOT NULL)
);
CREATE FUNCTION protect_campaign_dispatch_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'dispatch ledger cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW.workspace_id,NEW.campaign_id,NEW.contact_id,NEW.connection_id,NEW.message_version_id,NEW.actor_user_id,NEW.campaign_revision,NEW.credential_version,NEW.phone_normalized,NEW.agent_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.campaign_id,OLD.contact_id,OLD.connection_id,OLD.message_version_id,OLD.actor_user_id,OLD.campaign_revision,OLD.credential_version,OLD.phone_normalized,OLD.agent_id,OLD.created_at) THEN
    RAISE EXCEPTION 'dispatch identity is immutable';
  END IF;
  IF OLD.status<>'sending' AND ROW(NEW.status,NEW.provider_message_id,NEW.error_code) IS DISTINCT FROM ROW(OLD.status,OLD.provider_message_id,OLD.error_code) THEN
    RAISE EXCEPTION 'dispatch result is final';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaign_dispatch_attempt_guard BEFORE UPDATE OR DELETE ON campaign_dispatch_attempts FOR EACH ROW EXECUTE FUNCTION protect_campaign_dispatch_attempt();
