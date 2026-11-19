CREATE TABLE auth_rate_limits (
  key_hash BYTEA PRIMARY KEY CHECK (octet_length(key_hash) = 32),
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_rate_limits_expiry_idx ON auth_rate_limits (expires_at);
