ALTER TABLE message_versions ADD COLUMN archetype text;
ALTER TABLE message_versions ADD CONSTRAINT message_archetype_check CHECK (
  archetype IS NULL OR
  purpose='marketing' AND archetype IN ('launch','offer','promotion','invitation','reengagement','recovery') OR
  purpose='transactional' AND archetype IN ('confirmation','reminder','status_update','appointment') OR
  purpose='authentication' AND archetype IN ('OTP','verification','password_reset')
);
