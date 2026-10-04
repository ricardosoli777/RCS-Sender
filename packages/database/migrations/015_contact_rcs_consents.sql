CREATE TABLE contact_rcs_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  phone_normalized text NOT NULL CHECK (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  purpose text NOT NULL CHECK (purpose IN ('marketing','transactional','authentication')),
  revision integer NOT NULL CHECK (revision>0),
  state text NOT NULL CHECK (state IN ('granted','revoked')),
  source text NOT NULL CHECK (source IN ('manual_record','web_form','import_record','customer_request')),
  evidence_reference text NOT NULL CHECK (length(evidence_reference) BETWEEN 1 AND 128 AND evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'),
  observed_at timestamptz NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,phone_normalized,purpose,revision),
  FOREIGN KEY (workspace_id,contact_id) REFERENCES contacts(workspace_id,id)
);
CREATE INDEX contact_rcs_consents_latest ON contact_rcs_consents(workspace_id,phone_normalized,purpose,revision DESC);
CREATE FUNCTION protect_contact_rcs_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'consent history is immutable'; END $$;
CREATE TRIGGER contact_rcs_consent_immutable BEFORE UPDATE OR DELETE ON contact_rcs_consents FOR EACH ROW EXECUTE FUNCTION protect_contact_rcs_consent();
CREATE FUNCTION guard_contact_rcs_consent_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_revision integer; previous_observed timestamptz;
BEGIN
  PERFORM id FROM workspaces WHERE id=NEW.workspace_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM contacts WHERE workspace_id=NEW.workspace_id AND id=NEW.contact_id AND phone_normalized=NEW.phone_normalized) THEN RAISE EXCEPTION 'consent phone changed'; END IF;
  SELECT revision,observed_at INTO previous_revision,previous_observed FROM contact_rcs_consents WHERE workspace_id=NEW.workspace_id AND phone_normalized=NEW.phone_normalized AND purpose=NEW.purpose ORDER BY revision DESC LIMIT 1;
  IF NEW.revision<>COALESCE(previous_revision,0)+1 OR NEW.observed_at<previous_observed THEN RAISE EXCEPTION 'consent revision or observation is stale'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contact_rcs_consent_insert BEFORE INSERT ON contact_rcs_consents FOR EACH ROW EXECUTE FUNCTION guard_contact_rcs_consent_insert();
