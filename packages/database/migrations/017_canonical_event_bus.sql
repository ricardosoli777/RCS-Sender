CREATE TABLE webhook_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  provider_id text NOT NULL,
  credential_version text NOT NULL,
  body_hash text NOT NULL CHECK (body_hash ~ '^[a-f0-9]{64}$'),
  ciphertext text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','discarded','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,connection_id,body_hash),
  FOREIGN KEY(workspace_id,connection_id) REFERENCES provider_connections(workspace_id,id)
);
CREATE INDEX webhook_receipts_due ON webhook_receipts(available_at,id) WHERE status='pending';
CREATE TABLE canonical_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  connection_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  provider_event_id text NOT NULL CHECK(length(provider_event_id) BETWEEN 1 AND 256),
  event_type text NOT NULL CHECK(event_type IN ('message.sent','message.delivered','message.read','message.failed','message.received','action.selected','link.clicked','contact.subscribe','contact.unsubscribe')),
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,connection_id,provider_event_id),
  FOREIGN KEY(workspace_id,connection_id) REFERENCES provider_connections(workspace_id,id),
  FOREIGN KEY(workspace_id,receipt_id) REFERENCES webhook_receipts(workspace_id,id)
);
CREATE TABLE event_consumptions (
  workspace_id uuid NOT NULL,
  event_id uuid NOT NULL,
  consumer text NOT NULL CHECK(consumer IN ('campaigns','journeys','scoring','analytics','conversations','audit')),
  consumed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,event_id,consumer),
  FOREIGN KEY(workspace_id,event_id) REFERENCES canonical_events(workspace_id,id)
);
ALTER TABLE campaign_dispatch_attempts ADD CONSTRAINT dispatch_attempts_workspace_id_unique UNIQUE(workspace_id,id);
CREATE TABLE campaign_message_events (
  workspace_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY(workspace_id,attempt_id,event_id),
  FOREIGN KEY(workspace_id,attempt_id) REFERENCES campaign_dispatch_attempts(workspace_id,id),
  FOREIGN KEY(workspace_id,event_id) REFERENCES canonical_events(workspace_id,id)
);
CREATE FUNCTION protect_canonical_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'canonical event history is immutable'; END $$;
CREATE TRIGGER canonical_events_immutable BEFORE UPDATE OR DELETE ON canonical_events FOR EACH ROW EXECUTE FUNCTION protect_canonical_event();
CREATE TRIGGER event_consumptions_immutable BEFORE UPDATE OR DELETE ON event_consumptions FOR EACH ROW EXECUTE FUNCTION protect_canonical_event();
CREATE TRIGGER campaign_message_events_immutable BEFORE UPDATE OR DELETE ON campaign_message_events FOR EACH ROW EXECUTE FUNCTION protect_canonical_event();
CREATE FUNCTION protect_webhook_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'webhook receipt history is immutable'; END IF;
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.connection_id<>OLD.connection_id OR NEW.provider_id<>OLD.provider_id OR NEW.credential_version<>OLD.credential_version OR NEW.body_hash<>OLD.body_hash OR NEW.ciphertext<>OLD.ciphertext OR NEW.received_at<>OLD.received_at OR NEW.attempts<OLD.attempts OR (OLD.status<>'pending' AND NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'invalid receipt mutation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER webhook_receipts_guard BEFORE UPDATE OR DELETE ON webhook_receipts FOR EACH ROW EXECUTE FUNCTION protect_webhook_receipt();
