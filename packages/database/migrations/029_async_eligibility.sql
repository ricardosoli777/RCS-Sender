ALTER TABLE eligibility_checks ADD COLUMN requested_by_user_id uuid REFERENCES users(id);
