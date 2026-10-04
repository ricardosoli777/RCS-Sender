ALTER TABLE message_versions DROP CONSTRAINT message_versions_content_check;
ALTER TABLE message_versions ADD CONSTRAINT message_versions_content_check CHECK (jsonb_typeof(content)='object' AND content ? 'type' AND content->>'type' IN ('text','rich_card','carousel','media','file'));
CREATE TABLE provider_media_grants (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,connection_id) REFERENCES provider_connections(workspace_id,id),
  FOREIGN KEY(workspace_id,attempt_id) REFERENCES campaign_dispatch_attempts(workspace_id,id),
  FOREIGN KEY(workspace_id,asset_id) REFERENCES media_assets(workspace_id,id),
  CHECK(expires_at > created_at AND expires_at <= created_at + interval '7 days')
);
CREATE INDEX provider_media_grants_expiry_idx ON provider_media_grants(expires_at);
