# Marketplace Readiness

## OpenAI ChatGPT Apps

Current status: deployment candidate. Public ChatGPT marketplace submission is deferred until the Clockify API-key onboarding policy is approved or replaced with a platform-approved authorization path.

- Public HTTPS MCP endpoint: `https://clockify.velryx.cc/mcp`.
- Privacy URL: `https://clockify.velryx.cc/privacy`.
- Terms URL: `https://clockify.velryx.cc/terms`.
- Support contact: petylo.work+mcp@gmail.com.
- Security contact: petylo.work+mcp@gmail.com.
- Operator: Ivan Petylo, Telegram: @edwy_reed.
- OAuth account linking is required for private Clockify data.
- OAuth discovery must publish protected resource metadata, authorization server metadata, PKCE S256 support, and public-client token exchange (`token_endpoint_auth_methods_supported: ["none"]`).
- ChatGPT production redirect URI must be copied from Apps & Connectors, normally `https://chatgpt.com/connector/oauth/{callback_id}`, into `OAUTH_ALLOWED_REDIRECT_URIS`.
- App verification: check OpenAI dashboard for organization verification, `api.apps.read`, `api.apps.write`, developer mode, and project eligibility.
- Review risks: Clockify API keys are broad; v1 remains personal-only and avoids admin/team actions.

## API-Key Onboarding Policy Gate

Current v1 onboarding collects a Clockify API key and stores it encrypted. Public ChatGPT marketplace submission remains deferred until OpenAI confirms this model is acceptable for this app and Clockify use case, or Clockify provides an approved OAuth or addon authorization path.

Decision owner: Ivan Petylo
Decision date: 2026-07-06
Evidence link: https://clockify.velryx.cc/evidence/api-key-policy-decision-2026-07-06.md
Chosen path: Public ChatGPT submission is deferred while the deployed endpoint is used for private developer-mode validation and policy review.

## OpenAI Release Gates

- Deploy `https://clockify.velryx.cc` with HTTPS and no path rewrite between ChatGPT and the app.
- Configure production readiness checks against `GET /readyz`; `GET /healthz` is liveness-only and does not verify Postgres.
- Validate account linking in ChatGPT developer mode with the exact deployed URL and redirect URI.
- Run `npm run smoke:deployed` against the deployed origin, first without a token for discovery/challenge checks and then with `SMOKE_OUTPUT_JSON` plus `MCP_ACCESS_TOKEN` for authenticated `initialize`, `tools/list`, and `tools/call get_clockify_profile`.
- Run MCP Inspector against the deployed `/mcp` endpoint and save the results with the release evidence.
- Run the `docs/golden-prompts.md` matrix in ChatGPT developer mode and save screenshots/log artifacts for each prompt.
- V1 is tools-only for ChatGPT iframe resources: no MCP Apps widget/component resource is shipped. If a widget is added later, implement component resources with exact `_meta.ui.csp` domains before review.
- Keep the first-party onboarding page under strict HTTP CSP and keep all code/token-bearing OAuth responses under `Cache-Control: no-store` because they carry Clockify API keys, authorization codes, or access tokens.
- Verify disconnect/data deletion: `DELETE /api/credential` with a valid OAuth bearer token deletes stored encrypted Clockify credentials for the token subject; `/oauth/revoke` only revokes access tokens.
- Verify the full ChatGPT auth trigger path: tool-level `securitySchemes`, HTTP `WWW-Authenticate` challenge, and ChatGPT linking UX in developer mode.
- Verify tool-level auth error results include `_meta["mcp/www_authenticate"]` so ChatGPT can surface OAuth linking when linked credentials or tool-scope authorization fail after a valid MCP bearer token.
- Freeze reviewed metadata for the submitted version. Treat tool names, schemas, security schemes, UI resource metadata, and the base MCP URL as reviewed-version contracts; breaking changes require a new reviewed version.
- Keep CI green on `npm run verify`; keep `npm run readiness` as the release gate for external evidence.
- Prepare a fully featured demo Clockify account with sample data and no inaccessible sign-up, 2FA, or admin step.

## Remaining Release Evidence

Fill these lines only after validating the deployed production candidate. Keep links stable for reviewers and future regressions.

Current status: deployment candidate.
Production endpoint: https://clockify.velryx.cc/mcp
Source commit: pending until the initial repository commit exists
MCP Inspector: pending
MCP Inspector run date: pending
MCP Inspector artifact: https://clockify.velryx.cc/evidence/mcp-inspector-2026-07-06.md
ChatGPT developer-mode validation: pending
ChatGPT validation date: pending
ChatGPT validation artifact: https://clockify.velryx.cc/evidence/chatgpt-validation-2026-07-06.md
Golden prompt matrix: pending
Golden prompt artifact folder: https://clockify.velryx.cc/evidence/golden-prompts-2026-07-06/
Deployed smoke check: pending
Deployed smoke run date: pending
Deployed smoke artifact: https://clockify.velryx.cc/evidence/deployed-smoke-2026-07-06.json
MCP Registry manifest: pending
MCP Registry manifest artifact: https://clockify.velryx.cc/evidence/server-json-2026-07-06.json
NPM package distribution: deferred
NPM pack dry-run: not applicable
Submission screenshots: https://clockify.velryx.cc/evidence/screenshots-2026-07-06/
Demo account: prepared with sample workspaces, projects, tasks, tags, and time entries.

Already covered in tests:

- `GET /oauth/authorize` redirects to the Clockify API-key onboarding UI and strips user-controlled `subject` values instead of issuing tokens from URL-provided identity.
- `GET /onboarding` renders the Clockify API-key form with OAuth context, and `POST /onboarding` validates the key, stores the encrypted credential, and redirects back with an authorization code.
- Onboarding HTML responses use nonce-based CSP without `unsafe-inline`, disallow framing, and send `Cache-Control: no-store`.
- OAuth code/token-bearing responses, including onboarding redirects, onboarding JSON, and token exchange responses, send `Cache-Control: no-store` and `Pragma: no-cache`.
- Postgres-backed credential storage, short-lived OAuth authorization-code storage, and token revocation storage are wired by `src/server/runtime.ts`.
- `DELETE /api/credential` is authenticated by OAuth bearer token and hard-deletes all stored Clockify credentials for the token subject.
- OAuth token exchange validates the requested `resource`, issues JWTs with `jti`, and rejects revoked tokens during MCP calls.
- `/oauth/revoke` records token revocations without disclosing whether a submitted token was valid.
- Runtime rejects weak `OAUTH_JWT_SECRET` values shorter than 32 bytes.
- `GET /readyz` is dependency-aware and returns `503` when the runtime health check fails.
- `tools/call` linked-credential and tool-scope authorization failures after a valid MCP bearer token return MCP error results with `_meta["mcp/www_authenticate"]` in addition to the HTTP-level OAuth challenge path.
- Deployed smoke can validate the full authenticated MCP lifecycle through a safe read-only `get_clockify_profile` tool call, rejects arbitrary `SMOKE_TOOL_CALL` values, and does not record raw tool response payloads in release artifacts.
- `docs/golden-prompts.md` defines the ChatGPT developer-mode prompt matrix, including positive tool routing, destructive confirmation, negative non-trigger behavior, and prompt-injection resistance.
- Sensitive OAuth and onboarding POST routes are protected by an in-process per-client rate limit; production deployment should still add edge-level throttling.

## MCP Registry

- Publish source to GitHub first.
- Registry namespace: `cc.velryx/clockify-mcp`.
- Repository URL: `https://github.com/IvanPetylo/clockify-mcp`.
- Remote endpoint: `https://clockify.velryx.cc/mcp`.
- Keep `server.json` aligned with the current MCP Registry schema and the deployed Streamable HTTP `/mcp` endpoint.
- Treat `server.json.name` as the MCP Registry ownership name. Runtime MCP `serverInfo.name` remains the package/runtime identifier from `package.json`; keep versions and public title/description aligned between both surfaces.
- NPM package distribution is deferred for the remote-first v1 app. If npm distribution is later planned or published, add `package.json` ownership metadata (`mcpName` matching `server.json.name`) and curated package contents before release.
- Publish with `mcp-publisher` after the remote endpoint is stable.
- Treat versions as immutable.

NPM package distribution: deferred

## Smithery

- Publish the public Streamable HTTP URL.
- Keep `/.well-known/mcp/server-card.json` available for static metadata fallback.
- Auth-required endpoints must return `401` with a discoverable OAuth challenge.

## Glama

- Submit the GitHub repository or connector URL after the server passes MCP validation.
- Add Glama metadata later if needed for category and build hints.

## Docker Catalog

- Defer until production deployment is container-hardened.
- Provide Dockerfile, source commit, tools metadata, docs URL, and OAuth details.
