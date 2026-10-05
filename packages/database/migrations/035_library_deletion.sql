-- Keep immutable versions, references and execution history while removing library items.
ALTER TABLE messages ADD COLUMN deleted_at timestamptz;
ALTER TABLE campaigns ADD COLUMN deleted_at timestamptz;
ALTER TABLE journeys ADD COLUMN deleted_at timestamptz;
