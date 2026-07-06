# Deployment Runbook

ClockifyMCP is designed as a hosted remote MCP server. Production readiness depends on a stable HTTPS origin, Postgres persistence, reviewed legal pages, and live validation with MCP Inspector plus ChatGPT developer mode.

## Runtime Requirements

- Node.js 22 or newer.
- Production Postgres reachable from the app runtime.
- Public HTTPS origin with no path rewrite between ChatGPT and the app.
- Reverse proxy or platform routing that forwards `Authorization`, `Content-Type`, and OAuth query parameters unchanged.
- Durable secret storage for OAuth JWT and Clockify credential encryption keys.

## Environment

Required variables:

- `PUBLIC_BASE_URL`: canonical public HTTPS origin, `https://clockify.velryx.cc`. Local loopback development may use `http://localhost` or another supported loopback host.
- `TRUST_PROXY_HOPS`: trusted reverse-proxy hop count for `X-Forwarded-For` client IP resolution, default `1`.
- `DATABASE_URL`: Postgres connection string.
- `PGSSLMODE`: optional Postgres TLS mode. Prefer `verify-full` when the runtime trusts the database CA; use `require` only for managed databases that require TLS but need custom certificate handling outside Node's default trust store.
- `CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY`: 32-byte base64 key used to encrypt stored Clockify API keys.
- `CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION`: active key version label, for example `v1`.
- `OAUTH_JWT_SECRET`: random signing secret of at least 32 bytes.
- `OAUTH_ALLOWED_REDIRECT_URIS`: comma-separated redirect URI allow-list. Add the ChatGPT Apps & Connectors callback URI for the submitted app.
- `OAUTH_TOKEN_TTL_SECONDS`: optional access-token lifetime, default `3600`.
- `SENSITIVE_ROUTE_RATE_LIMIT_MAX`: optional in-process per-client limit for OAuth/onboarding POST attempts, default `20`.
- `SENSITIVE_ROUTE_RATE_LIMIT_WINDOW_MS`: optional in-process rate-limit window in milliseconds, default `60000`.

Never deploy with values copied from `.env.example`.

## Database

Apply every SQL migration in `src/db/migrations/` before routing production traffic to a new build.

Current migration:

```bash
psql "$DATABASE_URL" -f src/db/migrations/001_oauth_credentials.sql
```

The app uses Postgres for encrypted Clockify API-key storage, short-lived OAuth authorization codes, and OAuth token revocation state. Authorization codes are resource-bound, single-use records with a five-minute default TTL, so account linking survives app restarts and works across multiple app instances. If Postgres is unavailable, `/readyz` returns `503`.

Expired OAuth authorization codes are deleted opportunistically before new authorization codes are inserted. This keeps the public account-linking path from accumulating expired short-lived rows without requiring a separate scheduler for v1.

For production database TLS, use `PGSSLMODE=verify-full` when certificate verification works with the platform trust store. `PGSSLMODE=require` keeps compatibility with managed Postgres providers that terminate TLS with custom CA chains, but it does not verify the database certificate in Node.

## Build And Start

```bash
npm ci
npm run build
npm run start
```

The server listens on `PORT` or `3000`.

## Rate Limiting

The app applies an in-process per-client rate limit to sensitive POST routes:

- `/oauth/token`
- `/oauth/revoke`
- `/onboarding`
- `/api/onboarding/credential`

This protects token exchange and Clockify API-key onboarding from obvious brute-force or replay loops. It is not a replacement for an edge, load balancer, or WAF rate limit, especially when multiple app instances are running.

`TRUST_PROXY_HOPS` must match the production proxy topology. The trusted proxy must overwrite untrusted inbound `X-Forwarded-For` values; otherwise clients can spoof their apparent IP. If the app is directly exposed without a proxy, set `TRUST_PROXY_HOPS` only after adding an equivalent trusted IP forwarding layer.

## Health Checks

- `GET /healthz`: process liveness only. Use for restart decisions.
- `GET /readyz`: dependency readiness. It runs a lightweight Postgres query and returns `503` if the app should not receive traffic.

Use `/readyz` for platform readiness probes and load balancer target health. Use `/healthz` only for process-level liveness.

## Reverse Proxy

The public origin must preserve these paths:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/.well-known/mcp/server-card.json`
- `/oauth/authorize`
- `/oauth/token`
- `/oauth/revoke`
- `/onboarding`
- `/api/onboarding/credential`
- `/api/credential`
- `/privacy`
- `/terms`
- `/mcp`
- `/healthz`
- `/readyz`

Require HTTPS at the edge. Do not cache OAuth, onboarding, or MCP POST responses.

`deploy/Caddyfile.example` contains a ready-to-adapt Caddy reverse-proxy configuration for `clockify.velryx.cc`. It also serves sanitized release-review artifacts from `/var/www/clockify-mcp/evidence` at `/evidence/*` so the evidence links recorded in `docs/marketplace-readiness.md` have a stable public home.

## Disconnect And Data Deletion

`DELETE /api/credential` requires a valid OAuth bearer token for the deployed MCP resource. It hard-deletes all stored encrypted Clockify credentials for the token subject and returns `Cache-Control: no-store`.

Use this endpoint for user-initiated disconnect and data deletion support workflows. OAuth token revocation at `/oauth/revoke` only invalidates a submitted access token; it does not remove the stored Clockify API key by itself.

## Release Validation

For every code change, run:

```bash
npm run verify
```

`npm run verify` covers tests, typecheck, lint, and build. It intentionally does not run marketplace readiness because `npm run readiness` depends on external production metadata, legal/support decisions, and live validation evidence.

Before submitting to ChatGPT or external MCP catalogs, run the full marketplace release gate:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run readiness
```

For MCP Registry or future npm-package distribution checks, also inspect the local package shape before publishing:

```bash
npm run build
npm pack --dry-run --json
```

`server.json.name` is the registry ownership identifier. The runtime MCP `serverInfo.name` intentionally uses the package/runtime identifier from `package.json`; keep version, title, and description aligned before publishing.

The remote-first v1 release currently defers npm package distribution. If that decision changes, publish metadata must be added before `npm pack` output is used as release evidence.

Then validate the deployed endpoint:

- Deployed smoke check against public metadata, readiness, OAuth challenges for MCP and credential deletion, and optional authenticated MCP calls:

```bash
MCP_BASE_URL="https://clockify.velryx.cc" npm run smoke:deployed
SMOKE_OUTPUT_JSON="./artifacts/deployed-smoke.json" MCP_BASE_URL="https://clockify.velryx.cc" MCP_ACCESS_TOKEN="<linked-oauth-access-token>" npm run smoke:deployed
```

The authenticated command runs `initialize`, `notifications/initialized`, `tools/list`, and `tools/call` for `get_clockify_profile`. The linked demo credential must have enough Clockify access for that read-only call. The tokenless command is a preliminary discovery/challenge check and exits non-zero while authenticated MCP checks are skipped.

For metadata-only staging environments without a linked Clockify credential, use `SMOKE_TOOL_CALL=none` to disable the live tool call. Do not use that disabled run as marketplace release evidence.

Use the `SMOKE_OUTPUT_JSON` output from the `MCP_ACCESS_TOKEN` run as the deployed smoke release evidence artifact. The artifact records the checked URLs and pass/fail/skip results, but never the bearer token, tool response payload, profile email, or workspace names.

For a faster VPS-only sanity check without Node.js, run `sh deploy/validate-live.sh` and optionally set `MCP_ACCESS_TOKEN`. This writes sanitized public metadata and a curl-based smoke summary to `/var/www/clockify-mcp/evidence`; prefer the `SMOKE_OUTPUT_JSON` artifact for final marketplace evidence when Node.js is available.

- MCP Inspector against the production `/mcp` URL.
- ChatGPT developer-mode account linking with the exact production callback URI in `OAUTH_ALLOWED_REDIRECT_URIS`.
- Golden prompts from `docs/golden-prompts.md`, including profile lookup, entity search, current timer, list entries, start/stop timer, create/update entry, delete confirmation, report summary, a negative non-trigger prompt, and prompt-injection resistance.

Record validation evidence in `docs/marketplace-readiness.md` before marketplace submission.
