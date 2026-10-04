CREATE TABLE campaign_dispatch_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  expected_revision integer NOT NULL CHECK (expected_revision>0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','unresolved','discarded','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,run_id,contact_id),
  FOREIGN KEY (workspace_id,run_id,campaign_id) REFERENCES campaign_dispatch_runs(workspace_id,id,campaign_id),
  FOREIGN KEY (workspace_id,run_id,contact_id) REFERENCES campaign_dispatch_recipients(workspace_id,run_id,contact_id),
  CHECK ((status='processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (status<>'processing' AND lease_token IS NULL AND lease_until IS NULL))
);
CREATE INDEX campaign_dispatch_outbox_due ON campaign_dispatch_outbox(available_at,id) WHERE status='pending';
CREATE INDEX campaign_dispatch_outbox_recovery ON campaign_dispatch_outbox(lease_until,id) WHERE status='processing';
CREATE FUNCTION protect_dispatch_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'dispatch outbox history cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW.workspace_id,NEW.run_id,NEW.campaign_id,NEW.contact_id,NEW.actor_user_id,NEW.expected_revision,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.run_id,OLD.campaign_id,OLD.contact_id,OLD.actor_user_id,OLD.expected_revision,OLD.created_at) THEN RAISE EXCEPTION 'dispatch outbox identity is immutable'; END IF;
  IF OLD.status NOT IN ('pending','processing') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'dispatch outbox result is final'; END IF;
  IF NEW.attempts<OLD.attempts THEN RAISE EXCEPTION 'dispatch outbox attempts cannot decrease'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dispatch_outbox_guard BEFORE UPDATE OR DELETE ON campaign_dispatch_outbox FOR EACH ROW EXECUTE FUNCTION protect_dispatch_outbox();
