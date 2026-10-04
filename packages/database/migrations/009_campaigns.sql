CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100 AND name !~ '^\s*$'),
  objective text NOT NULL CHECK (length(objective) BETWEEN 1 AND 500 AND objective !~ '^\s*$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','ready','queued','running','paused','completed','cancelled','failed')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  provider_connection_id uuid,
  agent_id text CHECK (length(agent_id) BETWEEN 1 AND 128),
  audience_list_id uuid,
  message_version_id uuid,
  scheduled_at timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,id),
  FOREIGN KEY (workspace_id,provider_connection_id) REFERENCES provider_connections(workspace_id,id),
  CONSTRAINT campaigns_audience_list_fk FOREIGN KEY (workspace_id,audience_list_id) REFERENCES contact_lists(workspace_id,id),
  FOREIGN KEY (workspace_id,message_version_id) REFERENCES message_versions(workspace_id,id)
);
CREATE INDEX campaigns_workspace_idx ON campaigns(workspace_id,created_at,id);
CREATE FUNCTION protect_campaign_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'campaign identity is immutable';
  END IF;
  IF OLD.status <> 'draft' AND ROW(NEW.name,NEW.objective,NEW.provider_connection_id,NEW.agent_id,NEW.audience_list_id,NEW.message_version_id,NEW.scheduled_at)
    IS DISTINCT FROM ROW(OLD.name,OLD.objective,OLD.provider_connection_id,OLD.agent_id,OLD.audience_list_id,OLD.message_version_id,OLD.scheduled_at) THEN
    RAISE EXCEPTION 'campaign configuration is frozen';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaigns_configuration_guard BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION protect_campaign_configuration();
