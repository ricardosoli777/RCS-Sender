ALTER TABLE canonical_events ADD COLUMN dispatch_key text
  CHECK (dispatch_key IS NULL OR dispatch_key ~ '^dispatch-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$');
CREATE INDEX canonical_events_dispatch_key ON canonical_events(workspace_id,connection_id,dispatch_key,recipient_hash,created_at) WHERE dispatch_key IS NOT NULL;
