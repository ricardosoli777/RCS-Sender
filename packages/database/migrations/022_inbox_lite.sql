CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  recipient_hash text NOT NULL CHECK(recipient_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  assigned_user_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,connection_id,contact_id,recipient_hash),
  FOREIGN KEY(workspace_id,connection_id) REFERENCES provider_connections(workspace_id,id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id),
  FOREIGN KEY(workspace_id,assigned_user_id) REFERENCES workspace_members(workspace_id,user_id)
);
CREATE TABLE conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  event_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('message.received','action.selected')),
  content_ciphertext text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,event_id),
  FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id),
  FOREIGN KEY(workspace_id,event_id) REFERENCES canonical_events(workspace_id,id)
);
CREATE INDEX conversations_recent ON conversations(workspace_id,last_message_at DESC,id);
CREATE TRIGGER conversation_messages_immutable BEFORE UPDATE OR DELETE ON conversation_messages FOR EACH ROW EXECUTE FUNCTION protect_canonical_event();
CREATE FUNCTION protect_conversation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (NEW.id,NEW.workspace_id,NEW.connection_id,NEW.contact_id,NEW.recipient_hash,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.connection_id,OLD.contact_id,OLD.recipient_hash,OLD.created_at) OR NEW.revision<OLD.revision THEN RAISE EXCEPTION 'conversation identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conversation_identity_immutable BEFORE UPDATE OR DELETE ON conversations FOR EACH ROW EXECUTE FUNCTION protect_conversation_identity();
CREATE TABLE conversation_reply_drafts (
  workspace_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  request_id uuid NOT NULL,
  message_version_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,conversation_id,request_id),
  FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id),
  FOREIGN KEY(workspace_id,message_version_id) REFERENCES message_versions(workspace_id,id),
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id)
);
CREATE TRIGGER conversation_reply_drafts_immutable BEFORE UPDATE OR DELETE ON conversation_reply_drafts FOR EACH ROW EXECUTE FUNCTION protect_canonical_event();
