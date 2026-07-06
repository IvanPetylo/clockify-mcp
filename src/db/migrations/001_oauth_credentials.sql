CREATE TABLE IF NOT EXISTS clockify_credentials (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  key_version text NOT NULL,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS clockify_credentials_one_active_per_owner_idx
  ON clockify_credentials (owner_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS clockify_credentials_owner_created_at_idx
  ON clockify_credentials (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code text PRIMARY KEY,
  owner_id text NOT NULL,
  client_id text NOT NULL,
  resource text NOT NULL,
  redirect_uri text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  code_challenge text,
  code_challenge_method text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE oauth_authorization_codes
  ADD COLUMN IF NOT EXISTS resource text NOT NULL DEFAULT '';

ALTER TABLE oauth_authorization_codes
  ALTER COLUMN resource DROP DEFAULT;

CREATE INDEX IF NOT EXISTS oauth_authorization_codes_owner_idx
  ON oauth_authorization_codes (owner_id);

CREATE INDEX IF NOT EXISTS oauth_authorization_codes_expires_at_idx
  ON oauth_authorization_codes (expires_at);

CREATE TABLE IF NOT EXISTS oauth_token_revocations (
  token_id text PRIMARY KEY,
  owner_id text NOT NULL,
  client_id text,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS oauth_token_revocations_owner_idx
  ON oauth_token_revocations (owner_id);
