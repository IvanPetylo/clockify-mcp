# Deploy Today Checklist

Target origin: `https://clockify.velryx.cc`

Reviewer summary: `docs/review-handoff.md`

## 0. DNS Prerequisite

Create a DNS record for `clockify.velryx.cc` before running public smoke checks:

- `A` record to the VPS IPv4 address, or
- `AAAA` record to the VPS IPv6 address, or
- `CNAME` to the platform hostname if deploying to a managed app platform.

Verify:

```bash
nslookup clockify.velryx.cc
curl -i https://clockify.velryx.cc/healthz
```

## 1. Fast GHCR Deploy Path

```bash
git clone https://github.com/IvanPetylo/clockify-mcp.git
cd clockify-mcp
OAUTH_ALLOWED_REDIRECT_URIS="https://chatgpt.com/connector/oauth/<callback_id>" sh deploy/bootstrap-ghcr.sh
```

This path requires Docker Compose and `openssl` on the server. It generates `.env.production`, pulls `ghcr.io/ivanpetylo/clockify-mcp:v0.1.0-rc.1`, starts Postgres, applies migrations, and starts the app on `127.0.0.1:3000`.

## 2. Required Environment

If you prefer to prepare the environment manually or from a machine with Node.js 22+, start from `.env.production.example`:

```bash
npm run env:production
```

```bash
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=https://clockify.velryx.cc
TRUST_PROXY_HOPS=1
POSTGRES_PASSWORD=...
DATABASE_URL=postgres://...
PGSSLMODE=
CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY=...
CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION=v1
OAUTH_JWT_SECRET=...
OAUTH_ALLOWED_REDIRECT_URIS=https://chatgpt.com/connector/oauth/callback_id
OAUTH_TOKEN_TTL_SECONDS=3600
SENSITIVE_ROUTE_RATE_LIMIT_MAX=20
SENSITIVE_ROUTE_RATE_LIMIT_WINDOW_MS=60000
```

Replace `OAUTH_ALLOWED_REDIRECT_URIS` with the exact callback URI shown by ChatGPT Apps & Connectors.

Keep `PGSSLMODE=` for the bundled `compose.production.example.yml` Postgres container. For a managed external Postgres with TLS, set `PGSSLMODE=require` or `PGSSLMODE=verify-full` as appropriate for that provider.

## 3. Apply Database Migration Manually

After `npm run build`:

```bash
npm run db:migrate:prod
```

Source/dev path:

```bash
npm run db:migrate
```

Fallback if you prefer `psql`:

```bash
psql "$DATABASE_URL" -f src/db/migrations/001_oauth_credentials.sql
```

Docker Compose path:

```bash
docker compose -f compose.production.example.yml --env-file .env.production build app
docker compose -f compose.production.example.yml --env-file .env.production up -d postgres
docker compose -f compose.production.example.yml --env-file .env.production run --rm app npm run db:migrate:prod
```

## 4. Build And Start Manually

```bash
npm ci
npm run verify
npm run build
npm run start
```

Docker path:

```bash
docker build -t clockify-mcp:0.1.0 .
docker run --env-file .env.production -p 3000:3000 clockify-mcp:0.1.0
```

GHCR image path after `v0.1.0-rc.1` is published:

```bash
docker pull ghcr.io/ivanpetylo/clockify-mcp:v0.1.0-rc.1
docker run --env-file .env.production -p 127.0.0.1:3000:3000 ghcr.io/ivanpetylo/clockify-mcp:v0.1.0-rc.1
```

If GHCR package visibility is not public yet, run `docker login ghcr.io` on the server with a token that can read packages.

GHCR Docker Compose path:

```bash
docker compose -f compose.ghcr.example.yml --env-file .env.production pull
docker compose -f compose.ghcr.example.yml --env-file .env.production up -d postgres
docker compose -f compose.ghcr.example.yml --env-file .env.production run --rm app npm run db:migrate:prod
docker compose -f compose.ghcr.example.yml --env-file .env.production up -d
```

Docker Compose path:

```bash
docker compose -f compose.production.example.yml --env-file .env.production up -d --build
```

## 5. Reverse Proxy

Route `https://clockify.velryx.cc` to the app without path rewrites. Preserve:

- `Authorization`
- `Content-Type`
- OAuth query parameters
- `X-Forwarded-For`
- `X-Forwarded-Proto`

Use `/readyz` as the readiness check.

Caddy example:

```bash
sudo mkdir -p /var/www/clockify-mcp/evidence
sudo chown -R caddy:caddy /var/www/clockify-mcp/evidence || true
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

The Caddy example serves sanitized review artifacts from `/var/www/clockify-mcp/evidence` at `https://clockify.velryx.cc/evidence/...`. Do not place bearer tokens, Clockify API keys, OAuth codes, raw request headers, raw MCP tool payloads, profile emails, or private workspace/member data in that directory.

## 6. Smoke Checks

```bash
curl -i https://clockify.velryx.cc/healthz
curl -i https://clockify.velryx.cc/readyz
curl -i https://clockify.velryx.cc/privacy
curl -i https://clockify.velryx.cc/terms
curl -i https://clockify.velryx.cc/.well-known/oauth-protected-resource
curl -i https://clockify.velryx.cc/.well-known/oauth-authorization-server
curl -i https://clockify.velryx.cc/.well-known/mcp/server-card.json
MCP_BASE_URL="https://clockify.velryx.cc" npm run smoke:deployed
```

After ChatGPT account linking gives you an MCP bearer token:

```bash
SMOKE_OUTPUT_JSON="./artifacts/deployed-smoke.json" MCP_BASE_URL="https://clockify.velryx.cc" MCP_ACCESS_TOKEN="<linked-oauth-access-token>" npm run smoke:deployed
```

Publish sanitized evidence after validation:

```bash
sudo cp ./artifacts/deployed-smoke.json /var/www/clockify-mcp/evidence/deployed-smoke-2026-07-06.json
sudo cp ./server.json /var/www/clockify-mcp/evidence/server-json-2026-07-06.json
```

## 7. Evidence Still Needed

`npm run readiness` should have only these live-validation blockers before private/developer-mode review:

- MCP Inspector PASS evidence for `https://clockify.velryx.cc/mcp`
- ChatGPT developer-mode validation PASS evidence

After both are captured, update `docs/marketplace-readiness.md` from `pending` to `PASS` with dates and evidence URLs.

Public ChatGPT marketplace submission is still deferred while the API-key onboarding policy path is `private/developer-mode only`. Do not treat a developer-mode PASS as public marketplace approval.
