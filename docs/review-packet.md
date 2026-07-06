# ClockifyMCP Review Packet

Use this packet after `https://clockify.velryx.cc` is deployed and the live checks in `docs/deploy-today.md` have passed.

## Candidate

- App name: Clockify MCP
- Public origin: `https://clockify.velryx.cc`
- MCP endpoint: `https://clockify.velryx.cc/mcp`
- Privacy: `https://clockify.velryx.cc/privacy`
- Terms: `https://clockify.velryx.cc/terms`
- Repository: `https://github.com/IvanPetylo/clockify-mcp`
- Release: `https://github.com/IvanPetylo/clockify-mcp/releases/tag/v0.1.0-rc.1`
- Docker image: `ghcr.io/ivanpetylo/clockify-mcp:v0.1.0-rc.1`
- Support: Ivan Petylo, `petylo.work+mcp@gmail.com`, Telegram `@edwy_reed`
- Security contact: `petylo.work+mcp@gmail.com`

## What To Review

ClockifyMCP is a hosted remote MCP server for personal Clockify time tracking. It exposes tools for profile lookup, entity search, time entry listing, current timer inspection, timer start/stop, time entry create/update/delete, and report summarization.

The app intentionally does not expose team administration, billing, HR, payroll, or organization management features.

## Auth Model

Clockify public API uses API keys while ChatGPT account linking expects OAuth. This release wraps a user-provided Clockify API key behind the app's OAuth flow:

1. ChatGPT starts OAuth account linking.
2. ClockifyMCP displays the onboarding page.
3. The user enters a Clockify API key.
4. The service validates the key with Clockify.
5. The key is stored encrypted in Postgres.
6. MCP requests use the OAuth token subject to load only that user's encrypted credential.

Public ChatGPT marketplace submission is deferred until this API-key onboarding path is explicitly accepted for public review or replaced with an approved Clockify OAuth/addon authorization path. Private/developer-mode validation can proceed against the deployed endpoint.

## Required Live Evidence

Attach these artifacts or links before requesting final review:

- DNS resolution and HTTPS health check for `clockify.velryx.cc`.
- `GET /readyz` pass.
- OAuth protected resource metadata.
- OAuth authorization server metadata.
- MCP server card.
- Unauthenticated `/mcp` OAuth challenge.
- Authenticated MCP `initialize` and `tools/list`.
- Authenticated deployed smoke JSON from `SMOKE_OUTPUT_JSON` when available.
- MCP Inspector PASS output for `https://clockify.velryx.cc/mcp`.
- ChatGPT developer-mode account-linking PASS evidence.
- Golden prompt screenshots or transcripts from `docs/golden-prompts.md`.

Stable evidence URL prefix: `https://clockify.velryx.cc/evidence/`

## Reviewer Commands

```bash
curl -i https://clockify.velryx.cc/healthz
curl -i https://clockify.velryx.cc/readyz
curl -i https://clockify.velryx.cc/privacy
curl -i https://clockify.velryx.cc/terms
curl -i https://clockify.velryx.cc/.well-known/oauth-protected-resource
curl -i https://clockify.velryx.cc/.well-known/oauth-authorization-server
curl -i https://clockify.velryx.cc/.well-known/mcp/server-card.json
```

If a linked OAuth access token is available:

```bash
sudo env PUBLIC_BASE_URL="https://clockify.velryx.cc" MCP_ACCESS_TOKEN="<linked-oauth-access-token>" sh deploy/validate-live.sh
SMOKE_OUTPUT_JSON="./artifacts/deployed-smoke.json" MCP_BASE_URL="https://clockify.velryx.cc" MCP_ACCESS_TOKEN="<linked-oauth-access-token>" npm run smoke:deployed
```

## Pass Criteria

- Public HTTPS routes answer without path rewrites.
- `/readyz` returns healthy after migrations.
- OAuth metadata points to `https://clockify.velryx.cc`.
- Unauthenticated MCP requests return an OAuth `WWW-Authenticate` challenge.
- ChatGPT developer-mode account linking completes with the configured redirect URI.
- MCP Inspector passes against `/mcp`.
- Authenticated read-only tool smoke passes without leaking secrets in evidence artifacts.
- Destructive delete behavior follows the explicit confirmation requirement in `docs/golden-prompts.md`.
