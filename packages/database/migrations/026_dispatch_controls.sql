CREATE OR REPLACE FUNCTION protect_dispatch_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'dispatch outbox history cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW.workspace_id,NEW.run_id,NEW.campaign_id,NEW.contact_id,NEW.actor_user_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.run_id,OLD.campaign_id,OLD.contact_id,OLD.actor_user_id,OLD.created_at) THEN RAISE EXCEPTION 'dispatch outbox identity is immutable'; END IF;
  IF NEW.expected_revision<>OLD.expected_revision AND (NEW.expected_revision<>OLD.expected_revision+1 OR NEW.status NOT IN ('pending','discarded') OR EXISTS(SELECT 1 FROM campaign_dispatch_attempts a WHERE a.workspace_id=OLD.workspace_id AND a.campaign_id=OLD.campaign_id AND a.contact_id=OLD.contact_id) OR NOT EXISTS(SELECT 1 FROM campaigns c WHERE c.workspace_id=NEW.workspace_id AND c.id=NEW.campaign_id AND c.revision=NEW.expected_revision AND c.execution_mode='dispatch' AND c.status IN ('ready','paused','cancelled'))) THEN RAISE EXCEPTION 'invalid dispatch revision change'; END IF;
  IF OLD.status NOT IN ('pending','processing') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'dispatch outbox result is final'; END IF;
  IF NEW.attempts<OLD.attempts THEN RAISE EXCEPTION 'dispatch outbox attempts cannot decrease'; END IF;
  RETURN NEW;
END $$;
