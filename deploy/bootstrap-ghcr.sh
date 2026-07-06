#!/usr/bin/env sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-compose.ghcr.example.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://clockify.velryx.cc}"
OAUTH_ALLOWED_REDIRECT_URIS="${OAUTH_ALLOWED_REDIRECT_URIS:-}"

replace_env() {
  key="$1"
  value="$2"
  escaped_value=$(printf '%s' "$value" | sed 's/[\/&]/\\&/g')
  sed -i "s/^${key}=.*/${key}=${escaped_value}/" "$ENV_FILE"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command docker

if [ ! -f "$ENV_FILE" ]; then
  require_command openssl
  cp .env.production.example "$ENV_FILE"

  postgres_password=$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')
  credential_key=$(openssl rand -base64 32)
  jwt_secret=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=')

  replace_env "PUBLIC_BASE_URL" "$PUBLIC_BASE_URL"
  replace_env "POSTGRES_PASSWORD" "$postgres_password"
  replace_env "DATABASE_URL" "postgres://clockify_mcp:${postgres_password}@postgres:5432/clockify_mcp"
  replace_env "CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY" "$credential_key"
  replace_env "OAUTH_JWT_SECRET" "$jwt_secret"
  echo "Generated $ENV_FILE."
else
  echo "Using existing $ENV_FILE."
fi

if [ -n "$OAUTH_ALLOWED_REDIRECT_URIS" ]; then
  replace_env "OAUTH_ALLOWED_REDIRECT_URIS" "$OAUTH_ALLOWED_REDIRECT_URIS"
fi

if grep -Eq 'change-me|replace-with|callback_id' "$ENV_FILE"; then
  echo "$ENV_FILE still contains placeholder values." >&2
  echo "Set OAUTH_ALLOWED_REDIRECT_URIS to the ChatGPT callback URI and rerun:" >&2
  echo "  OAUTH_ALLOWED_REDIRECT_URIS=https://chatgpt.com/connector/oauth/<callback_id> sh deploy/bootstrap-ghcr.sh" >&2
  exit 2
fi

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d postgres
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm app npm run db:migrate:prod
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

echo "Local app should now answer on 127.0.0.1:3000. Configure Caddy, DNS, then check:"
echo "  curl -i ${PUBLIC_BASE_URL}/healthz"
echo "  curl -i ${PUBLIC_BASE_URL}/readyz"
