# Release Evidence

This directory documents the evidence bundle expected before marketplace submission. Keep sanitized guidance here in Git. Keep raw local captures under `artifacts/`, which is intentionally ignored.

## Local Capture Layout

```text
artifacts/
  deployed-smoke.json
  server.json
  mcp-inspector/
  chatgpt-developer-mode/
  screenshots/
```

Use `docs/golden-prompts.md` for ChatGPT developer-mode prompt coverage and `docs/deployment.md` for deployed smoke commands.

## Publication Rules

- Do not commit `artifacts/`.
- Do not publish bearer tokens, Clockify API keys, OAuth authorization codes, raw request headers, raw MCP tool payloads, profile emails, or workspace member data.
- Redact personal Clockify descriptions and IDs unless the demo account data was intentionally created for public review.
- Upload only sanitized artifacts to stable links, then record those links in `docs/marketplace-readiness.md`.
- `npm run readiness` should keep failing until the stable evidence URLs and live validation PASS statuses are recorded.

The provided Caddy deployment example serves public evidence links from `/var/www/clockify-mcp/evidence` at `https://clockify.velryx.cc/evidence/...`.

## Required Evidence

- `submission-decision-pack.md`: completed owner decisions copied or linked from `docs/submission-decision-pack.md`.
- Authenticated deployed smoke JSON from `SMOKE_OUTPUT_JSON` with `get_clockify_profile` enabled.
- Optional `deploy/validate-live.sh` output for VPS-level public endpoint sanity checks.
- MCP Registry `server.json` or `mcp-publisher` validation output for the exact deployed version.
- MCP Inspector or API Playground output for the production `/mcp` endpoint.
- ChatGPT developer-mode account-linking validation.
- Golden prompt screenshots/logs for every case in `docs/golden-prompts.md`.
- Submission screenshots and catalog metadata assets.
