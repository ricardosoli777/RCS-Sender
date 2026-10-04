CREATE TABLE cipher_maintenance_permits (
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  target_table text NOT NULL,
  workspace_id uuid NOT NULL,
  target_id uuid NOT NULL,
  cipher_column text NOT NULL,
  previous_ciphertext text NOT NULL,
  replacement_ciphertext text,
  operation text NOT NULL CHECK(operation IN ('rotate','compact')),
  PRIMARY KEY(transaction_id,target_table,workspace_id,target_id)
);
REVOKE ALL ON cipher_maintenance_permits FROM PUBLIC;
CREATE FUNCTION authorized_cipher_update(target text,previous jsonb,replacement jsonb) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE permit cipher_maintenance_permits; column_name text;
BEGIN
  SELECT * INTO permit FROM cipher_maintenance_permits WHERE transaction_id=txid_current() AND target_table=target AND workspace_id=(previous->>'workspace_id')::uuid AND target_id=COALESCE(previous->>'id',previous->>'connection_id')::uuid;
  IF NOT FOUND THEN RETURN false; END IF;
  column_name:=permit.cipher_column;
  IF (previous-column_name) IS DISTINCT FROM (replacement-column_name) OR previous->>column_name IS DISTINCT FROM permit.previous_ciphertext OR replacement->>column_name IS DISTINCT FROM permit.replacement_ciphertext THEN RETURN false; END IF;
  IF permit.operation='compact' THEN
    RETURN target='webhook_receipts' AND column_name='ciphertext' AND replacement->>column_name IS NULL AND previous->>'status' IN ('completed','discarded') AND (previous->>'updated_at')::timestamptz<now()-interval '30 days';
  END IF;
  RETURN permit.replacement_ciphertext IS NOT NULL AND (target,column_name) IN (('canonical_events','payload_ciphertext'),('conversation_messages','content_ciphertext'),('webhook_endpoint_versions','config_ciphertext'),('webhook_receipts','ciphertext'),('journey_webhook_actions','payload_ciphertext'));
END $$;
CREATE OR REPLACE FUNCTION protect_canonical_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND authorized_cipher_update(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'canonical event history is immutable';
END $$;
CREATE OR REPLACE FUNCTION protect_webhook_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND authorized_cipher_update(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'webhook receipt history is immutable'; END IF;
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.connection_id<>OLD.connection_id OR NEW.provider_id<>OLD.provider_id OR NEW.credential_version<>OLD.credential_version OR NEW.body_hash<>OLD.body_hash OR NEW.ciphertext IS DISTINCT FROM OLD.ciphertext OR NEW.received_at<>OLD.received_at OR NEW.attempts<OLD.attempts OR (OLD.status<>'pending' AND NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'invalid receipt mutation'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION protect_journey_webhook_action() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND authorized_cipher_update(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' OR ROW(NEW.id,NEW.workspace_id,NEW.enrollment_id,NEW.node_id,NEW.endpoint_version_id,NEW.payload_ciphertext,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.enrollment_id,OLD.node_id,OLD.endpoint_version_id,OLD.payload_ciphertext,OLD.created_at) OR (OLD.status IN ('accepted','rejected','unknown','cancelled') AND NEW IS DISTINCT FROM OLD) OR (OLD.status='sending' AND NEW.status='pending') THEN RAISE EXCEPTION 'webhook attempt is immutable'; END IF;
  RETURN NEW;
END $$;
ALTER TABLE webhook_receipts ALTER COLUMN ciphertext DROP NOT NULL;
ALTER TABLE webhook_receipts ADD CONSTRAINT receipt_pending_payload CHECK(ciphertext IS NOT NULL OR status IN ('completed','discarded'));
