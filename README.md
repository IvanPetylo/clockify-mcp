# ClockifyMCP

Remote-first MCP server and ChatGPT app for personal Clockify time tracking.

ClockifyMCP exposes a small, review-friendly set of Clockify tools for ChatGPT and other MCP clients:

- Read profile, workspaces, projects, tasks, clients, tags, entries, current timer, and report summaries.
- Start/stop timers and create/update personal time entries.
- Delete personal time entries only with exact server-side confirmation.

The first release intentionally avoids team/admin/project management features to reduce permission and review risk.

## Status

ClockifyMCP is a pre-deployment release candidate for a hosted remote MCP server. The tested core includes:

- Clockify REST client with pagination, retry, and error normalization.
- Encrypted Clockify API key storage primitives.
- Local OAuth access-token utilities, authorization-code + PKCE service, JWT `jti`, and persisted authorization-code/token revocation support.
- MCP tool descriptors, schema validation, and tool handlers.
- Fastify HTTP boundary for liveness/readiness, OAuth metadata, MCP server card, OAuth challenge, OAuth authorize/token/revoke routes, Clockify API-key onboarding UI/API, stored credential deletion, `initialize`, `tools/list`, and `tools/call`.
- Production app factory that wires Postgres credential storage, Postgres OAuth authorization-code and token revocation storage, OAuth service, and Clockify clients from environment variables.

The public deployment target is `https://clockify.velryx.cc`. Live MCP Inspector and ChatGPT developer-mode validation must still be captured after deployment.

Support: petylo.work+mcp@gmail.com
Security: petylo.work+mcp@gmail.com
Telegram: @edwy_reed

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run readiness
```

Migration SQL lives in `src/db/migrations/`. Apply it to the production Postgres database before starting the hosted app.

Production OAuth authorization codes are stored in Postgres as short-lived, single-use records. This keeps ChatGPT account linking resilient across app restarts and multi-instance deployments.

Deployment details are documented in `docs/deployment.md`, including environment variables, migrations, HTTPS proxy requirements, and `GET /healthz` versus `GET /readyz`.

Marketplace validation and implementation standards are tracked in `docs/standards-and-validation.md`.

Run locally:

```bash
cp .env.example .env
# Replace CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY and OAUTH_JWT_SECRET in .env.
# Apply src/db/migrations/001_oauth_credentials.sql to the Postgres database from .env.
npm run dev
```

`npm run dev` loads `.env` when it exists. `PUBLIC_BASE_URL=http://localhost:3000` is accepted only for local loopback development; deployed ChatGPT/OAuth linking still requires a public HTTPS origin. The local runtime still requires a reachable Postgres database with migrations applied.

Generate a 32-byte encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Configuration

Required production environment:

- `PUBLIC_BASE_URL`: public HTTPS app origin. Local loopback development may use `http://localhost:3000`.
- `TRUST_PROXY_HOPS`: number of trusted reverse-proxy hops for client IP resolution, default `1` in production runtime.
- `DATABASE_URL`: production database connection.
- `CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY`: 32-byte base64 key for encrypted Clockify API keys.
- `CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION`: active encryption key version.
- `OAUTH_JWT_SECRET`: signing secret for local OAuth access tokens.
- `OAUTH_ALLOWED_REDIRECT_URIS`: comma-separated allow-list for OAuth redirects.
- `OAUTH_TOKEN_TTL_SECONDS`: access-token lifetime.
- `SENSITIVE_ROUTE_RATE_LIMIT_MAX`: per-client limit for OAuth/onboarding POST attempts.
- `SENSITIVE_ROUTE_RATE_LIMIT_WINDOW_MS`: rate-limit window for OAuth/onboarding POST attempts.

For production ChatGPT app linking, add the redirect URI shown in Apps & Connectors, typically `https://chatgpt.com/connector/oauth/{callback_id}`, to `OAUTH_ALLOWED_REDIRECT_URIS`.

`.env.example` includes local sample values only. Never commit real Clockify API keys or OAuth secrets.

`npm run readiness` is a release gate for marketplace submission. It is expected to fail until live MCP Inspector evidence and ChatGPT developer-mode validation are recorded for the deployed endpoint.

Public ChatGPT submission is also blocked until the Clockify API-key onboarding policy gate in `docs/marketplace-readiness.md` is resolved. The current v1 flow asks users to enter a Clockify API key into ClockifyMCP, which must be explicitly accepted for public review or replaced with an approved Clockify authorization path.

## Security Model

Clockify public API uses API keys. ChatGPT Apps account linking expects OAuth. ClockifyMCP therefore implements an OAuth wrapper:

1. User links ClockifyMCP through ChatGPT.
2. ChatGPT redirects the user to the ClockifyMCP onboarding UI.
3. User enters a Clockify API key in the ClockifyMCP onboarding UI.
4. The service validates the key with Clockify and stores only encrypted ciphertext plus non-secret metadata.
5. MCP tools use OAuth token subject + credential owner checks before decrypting credentials.

Clockify API keys are not scope-limited by Clockify, so v1 limits the exposed server-side tool surface to personal time tracking.

OAuth token exchange and Clockify API-key onboarding POST routes have an in-process rate limit. Keep an edge or platform rate limit in front of the public endpoint as well.

Users can disconnect stored Clockify credentials by calling `DELETE /api/credential` with a valid OAuth bearer token. The endpoint deletes all stored encrypted Clockify credentials for the token subject and returns a no-store response.

## MCP Tools

V1 tools:

- `get_clockify_profile`
- `search_clockify_entities`
- `list_time_entries`
- `get_current_timer`
- `start_timer`
- `stop_timer`
- `create_time_entry`
- `update_time_entry`
- `delete_time_entry`
- `summarize_time_report`

Tool descriptors are defined in `src/mcp/tools.ts`; handlers are in `src/mcp/handlers.ts`.

## Marketplace Checklist

Before submitting to ChatGPT or MCP catalogs:

- Deploy a stable public HTTPS endpoint.
- Configure deployment readiness probes against `GET /readyz`.
- Verify OAuth account linking in ChatGPT developer mode.
- Validate MCP with MCP Inspector.
- Capture screenshots and test prompts required by the OpenAI submission form.
- Publish privacy policy and terms at stable public URLs.
- Prepare demo Clockify account with sample data and no blocking 2FA/sign-up step.
- Verify organization permissions and OpenAI project eligibility in the dashboard.
- Run `npm run readiness` and resolve every reported blocker.

## Distribution Plan

Primary:

- Public hosted remote MCP endpoint for ChatGPT Apps.
- GitHub repository as source of truth.
- Official MCP Registry metadata pointing to the remote endpoint.

Secondary:

- Smithery remote URL publishing.
- Glama connector metadata.
- Docker MCP Catalog after container hardening.

CAKE/Clockify Marketplace add-on support is a later track because it uses `X-Addon-Token` rather than the API-key OAuth wrapper used by v1.
