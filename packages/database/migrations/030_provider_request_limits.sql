CREATE TABLE provider_request_windows (
  scope_hash text PRIMARY KEY CHECK(scope_hash ~ '^[a-f0-9]{64}$'),
  next_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
