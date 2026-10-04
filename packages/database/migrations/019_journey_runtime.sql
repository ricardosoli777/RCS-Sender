ALTER TABLE canonical_events ALTER COLUMN connection_id DROP NOT NULL;
ALTER TABLE canonical_events ALTER COLUMN receipt_id DROP NOT NULL;
ALTER TABLE canonical_events DROP CONSTRAINT canonical_events_event_type_check;
ALTER TABLE canonical_events ADD CONSTRAINT canonical_events_event_type_check CHECK(event_type IN ('message.sent','message.delivered','message.read','message.failed','message.received','action.selected','link.clicked','contact.subscribe','contact.unsubscribe','contact.tag_added','contact.tag_removed','campaign.started','campaign.completed','journey.entered','journey.node_entered','journey.node_completed','journey.goal_reached','journey.completed','lead.score_changed','lead.qualified'));
CREATE TABLE journey_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  version_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  phone_normalized text NOT NULL CHECK(phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  entry_source text NOT NULL CHECK(entry_source IN ('manual','contact_list','campaign','tag_added','API_event')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','waiting','completed','converted','stopped','opted_out','failed')),
  current_node_id text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  wake_at timestamptz,
  context jsonb NOT NULL DEFAULT '{}',
  error_code text,
  entered_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,journey_id) REFERENCES journeys(workspace_id,id),
  FOREIGN KEY(workspace_id,version_id,journey_id) REFERENCES journey_versions(workspace_id,id,journey_id),
  FOREIGN KEY(workspace_id,version_id,current_node_id) REFERENCES journey_nodes(workspace_id,version_id,node_id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id),
  CHECK((status IN ('completed','converted','stopped','opted_out','failed'))=(completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX journey_active_enrollment ON journey_enrollments(workspace_id,journey_id,contact_id) WHERE status IN ('active','waiting');
CREATE INDEX journey_enrollments_due ON journey_enrollments(wake_at,id) WHERE status IN ('active','waiting');
CREATE TABLE journey_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  revision integer NOT NULL,
  node_id text NOT NULL,
  outcome text NOT NULL,
  next_node_id text,
  event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,enrollment_id,revision),
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES journey_enrollments(workspace_id,id),
  FOREIGN KEY(workspace_id,event_id) REFERENCES canonical_events(workspace_id,id)
);
CREATE TRIGGER journey_transitions_immutable BEFORE UPDATE OR DELETE ON journey_transitions FOR EACH ROW EXECUTE FUNCTION protect_journey_version();
CREATE FUNCTION protect_journey_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'enrollment history is immutable'; END IF;
  IF ROW(NEW.id,NEW.workspace_id,NEW.journey_id,NEW.version_id,NEW.contact_id,NEW.phone_normalized,NEW.actor_user_id,NEW.entry_source,NEW.entered_at) IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.journey_id,OLD.version_id,OLD.contact_id,OLD.phone_normalized,OLD.actor_user_id,OLD.entry_source,OLD.entered_at) OR NEW.revision<OLD.revision OR (OLD.status IN ('completed','converted','stopped','opted_out','failed') AND NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'invalid enrollment mutation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journey_enrollments_guard BEFORE UPDATE OR DELETE ON journey_enrollments FOR EACH ROW EXECUTE FUNCTION protect_journey_enrollment();
CREATE TABLE contact_tags (
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  tag text NOT NULL CHECK(tag ~ '^[a-z0-9_:-]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,contact_id,tag),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id)
);
CREATE TABLE lead_scores (
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  score integer NOT NULL DEFAULT 0 CHECK(score BETWEEN 0 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,contact_id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id)
);
CREATE TABLE lead_score_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  source text NOT NULL,
  source_key text NOT NULL,
  event_id uuid,
  delta integer NOT NULL,
  previous_score integer NOT NULL,
  new_score integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,contact_id,source_key),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id),
  FOREIGN KEY(workspace_id,event_id) REFERENCES canonical_events(workspace_id,id),
  CHECK(new_score=previous_score+delta AND previous_score BETWEEN 0 AND 1000000 AND new_score BETWEEN 0 AND 1000000)
);
CREATE TRIGGER lead_score_history_immutable BEFORE UPDATE OR DELETE ON lead_score_history FOR EACH ROW EXECUTE FUNCTION protect_journey_version();
CREATE TABLE contact_custom_fields (
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  fields jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY(workspace_id,contact_id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id),
  CHECK(jsonb_typeof(fields)='object')
);
CREATE TABLE journey_goals (
  workspace_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  node_id text NOT NULL,
  goal text NOT NULL,
  reached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,enrollment_id,node_id),
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES journey_enrollments(workspace_id,id)
);
CREATE TRIGGER journey_goals_immutable BEFORE UPDATE OR DELETE ON journey_goals FOR EACH ROW EXECUTE FUNCTION protect_journey_version();
