CREATE TABLE journey_entry_rules (
  workspace_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  tag text CHECK(tag ~ '^[a-z0-9_:-]{1,64}$'),
  duplicate_policy text NOT NULL DEFAULT 'prevent_active_duplicate' CHECK(duplicate_policy IN ('prevent_active_duplicate','prevent_any_duplicate')),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,journey_id),
  FOREIGN KEY(workspace_id,journey_id) REFERENCES journeys(workspace_id,id)
);
CREATE TABLE journey_entry_batches (
  id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  version_id uuid NOT NULL,
  source text NOT NULL CHECK(source IN ('contact_list','campaign')),
  source_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,id),
  FOREIGN KEY(workspace_id,journey_id,version_id) REFERENCES journey_versions(workspace_id,journey_id,id)
);
CREATE TABLE journey_entry_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  version_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  phone_normalized text NOT NULL CHECK(phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  source text NOT NULL CHECK(source IN ('contact_list','campaign','tag_added','API_event')),
  source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 256),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','discarded')),
  enrollment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,journey_id,contact_id,source_key),
  FOREIGN KEY(workspace_id,journey_id,version_id) REFERENCES journey_versions(workspace_id,journey_id,id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id),
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES journey_enrollments(workspace_id,id)
);
CREATE TRIGGER journey_entry_batches_immutable BEFORE UPDATE OR DELETE ON journey_entry_batches FOR EACH ROW EXECUTE FUNCTION protect_canonical_event();
CREATE FUNCTION protect_journey_entry_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR ROW(NEW.id,NEW.workspace_id,NEW.journey_id,NEW.version_id,NEW.contact_id,NEW.phone_normalized,NEW.actor_user_id,NEW.source,NEW.source_key,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.journey_id,OLD.version_id,OLD.contact_id,OLD.phone_normalized,OLD.actor_user_id,OLD.source,OLD.source_key,OLD.created_at) OR (OLD.status IN ('completed','discarded') AND NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'journey entry intent is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journey_entry_outbox_guard BEFORE UPDATE OR DELETE ON journey_entry_outbox FOR EACH ROW EXECUTE FUNCTION protect_journey_entry_intent();
