# Review Handoff

## Service

- Name: Clockify MCP
- Public origin: `https://clockify.velryx.cc`
- MCP endpoint: `https://clockify.velryx.cc/mcp`
- Privacy policy: `https://clockify.velryx.cc/privacy`
- Terms: `https://clockify.velryx.cc/terms`
- Support: Ivan Petylo, petylo.work+mcp@gmail.com, Telegram: @edwy_reed
- Security contact: petylo.work+mcp@gmail.com

## Repository And Registry

- Repository: `https://github.com/velryx/clockify-mcp`
- MCP Registry namespace: `cc.velryx/clockify-mcp`
- Runtime package name: `clockify-mcp`
- Version: `0.1.0`
- NPM package distribution: deferred

## What The App Does

ClockifyMCP is a hosted remote MCP server for personal Clockify time tracking. It exposes personal time-entry workflows to ChatGPT and other MCP clients:

- read Clockify profile and workspaces
- search projects, tasks, clients, and tags
- list time entries and current timer
- start and stop timers
- create and update time entries
- delete time entries only with explicit matching confirmation
- summarize time reports

It intentionally does not expose team administration, billing, HR, payroll, or organization management features.

## Authentication Model

Clockify public API uses API keys. ChatGPT account linking expects OAuth. ClockifyMCP wraps the user's Clockify API key behind a local OAuth flow:

1. ChatGPT starts OAuth account linking.
2. ClockifyMCP shows an onboarding page.
3. The user enters a Clockify API key.
4. The service validates the key with Clockify.
5. The key is stored encrypted in Postgres.
6. MCP tool calls use the OAuth token subject to load only that user's credential.

Public ChatGPT marketplace submission remains deferred until OpenAI confirms this API-key onboarding pattern is acceptable or the app migrates to a Clockify-approved OAuth/addon path.

## Deployment Checks

Run before review:

```bash
npm run verify
npm run readiness
```

Expected before live validation is complete:

- `npm run verify` passes.
- `npm run readiness` fails only on MCP Inspector evidence and ChatGPT developer-mode validation evidence.

Expected after private/developer-mode validation is captured:

- MCP Inspector, deployed smoke, and ChatGPT developer-mode evidence can be marked `PASS`.
- Public ChatGPT marketplace submission must still remain deferred while the API-key onboarding policy path is `private/developer-mode only`.
- To move from private review to public marketplace submission, replace the API-key policy decision with either `OpenAI-approved` evidence for this onboarding model or a Clockify OAuth/addon migration decision.

Run after deployment:

```bash
curl -i https://clockify.velryx.cc/healthz
curl -i https://clockify.velryx.cc/readyz
curl -i https://clockify.velryx.cc/privacy
curl -i https://clockify.velryx.cc/terms
curl -i https://clockify.velryx.cc/.well-known/oauth-protected-resource
curl -i https://clockify.velryx.cc/.well-known/oauth-authorization-server
curl -i https://clockify.velryx.cc/.well-known/mcp/server-card.json
MCP_BASE_URL="https://clockify.velryx.cc" npm run smoke:deployed
SMOKE_OUTPUT_JSON="./artifacts/deployed-smoke.json" MCP_BASE_URL="https://clockify.velryx.cc" MCP_ACCESS_TOKEN="<linked-oauth-access-token>" npm run smoke:deployed
```

## Evidence To Attach

- DNS resolution and HTTPS health check for `clockify.velryx.cc`.
- Deployed smoke JSON from authenticated `SMOKE_OUTPUT_JSON`.
- MCP Inspector PASS output for `https://clockify.velryx.cc/mcp`.
- ChatGPT developer-mode account-linking validation evidence.
- Golden prompt screenshots/logs from `docs/golden-prompts.md`.
- Sanitized screenshots for marketplace/catalog submission.

## Current Known External Blockers

- `clockify.velryx.cc` must resolve publicly before live smoke checks can run.
- MCP Inspector evidence can only be captured after deployment.
- ChatGPT developer-mode validation can only be captured after deployment and redirect URI configuration.
