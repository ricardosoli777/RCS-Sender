ALTER TABLE campaigns ADD COLUMN journey_enrollment_id uuid;
ALTER TABLE canonical_events ADD COLUMN provider_message_id text;
ALTER TABLE canonical_events ADD COLUMN recipient_hash text CHECK(recipient_hash ~ '^[a-f0-9]{64}$');
CREATE INDEX canonical_message_correlation ON canonical_events(workspace_id,connection_id,provider_message_id,recipient_hash);
ALTER TABLE campaigns ADD CONSTRAINT campaign_journey_enrollment_fk FOREIGN KEY(workspace_id,journey_enrollment_id) REFERENCES journey_enrollments(workspace_id,id);
CREATE TABLE journey_message_actions (
  workspace_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  node_id text NOT NULL,
  campaign_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,enrollment_id,node_id),
  UNIQUE(workspace_id,campaign_id),
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES journey_enrollments(workspace_id,id),
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id)
);
CREATE TRIGGER journey_message_actions_immutable BEFORE UPDATE OR DELETE ON journey_message_actions FOR EACH ROW EXECUTE FUNCTION protect_journey_version();
