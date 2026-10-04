-- Existing checks cannot prove which phone was queried. Do not backfill them
-- from current contacts: they must be refreshed before reuse.
ALTER TABLE eligibility_checks ADD COLUMN phone_normalized text CHECK (phone_normalized ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE eligibility_checks DROP CONSTRAINT eligibility_checks_reason_check;
ALTER TABLE eligibility_checks ADD CONSTRAINT eligibility_checks_reason_check CHECK (reason IN ('checking','provider_checked','unsupported','provider_unavailable','opted_out','connection_unavailable','contact_changed'));
