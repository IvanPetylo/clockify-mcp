# Standards And Validation Notes

This document records the implementation standards currently used for ClockifyMCP. Treat it as a working engineering checklist, not a substitute for live marketplace review.

## Sources Checked

- OpenAI Apps SDK authentication: `https://developers.openai.com/apps-sdk/build/auth`
- OpenAI Apps SDK reference: `https://developers.openai.com/apps-sdk/reference`
- OpenAI Apps SDK security and privacy: `https://developers.openai.com/apps-sdk/guides/security-privacy`
- OpenAI Apps SDK testing: `https://developers.openai.com/apps-sdk/deploy/testing`
- OpenAI Apps SDK submission guidelines: `https://developers.openai.com/apps-sdk/app-submission-guidelines`
- Anthropic subagent guidance: `https://code.claude.com/docs/en/sub-agents`
- Anthropic advisor pattern: `https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool`

## OpenAI Apps Compatibility Checklist

- Publish protected resource metadata at `/.well-known/oauth-protected-resource`.
- Publish authorization server metadata at `/.well-known/oauth-authorization-server`.
- Preserve the OAuth `resource` parameter through authorization and token exchange.
- Use authorization-code flow with PKCE S256.
- Enforce PKCE verifier length/charset and S256 challenge shape before issuing or exchanging OAuth codes.
- Store authorization codes durably as short-lived, resource-bound, single-use records so hosted deployments tolerate restarts and multiple app instances.
- Validate authorization-code client binding, redirect URI, resource, and PKCE before final atomic consumption so malformed retries do not destroy a valid account-linking code.
- Verify bearer tokens server-side for issuer, audience, expiry, revocation, and scopes.
- Return HTTP `WWW-Authenticate` challenges for unauthenticated MCP requests.
- Declare per-tool `securitySchemes`, including scopes, in every tool descriptor.
- Mirror `securitySchemes` in descriptor `_meta` for compatibility.
- Return tool-level auth error results with `_meta["mcp/www_authenticate"]` when a linked Clockify credential or tool-scope authorization fails after a valid MCP bearer token.
- Use `readOnlyHint`, `destructiveHint`, and `openWorldHint` annotations accurately.
- Declare `outputSchema` for every tool that returns `structuredContent`.
- Keep tool inputs minimal and purpose-driven; do not request raw chat history.
- Validate all tool input server-side even when the model supplies arguments.
- Keep irreversible actions behind explicit confirmation.
- Redact secrets and reject secret-like tool output before returning results.
- Keep onboarding and OAuth responses under `Cache-Control: no-store`.
- Keep credential deletion responses under `Cache-Control: no-store` for both success and failure branches.
- Rate-limit OAuth token exchange and Clockify API-key onboarding attempts at the app and edge layers.
- Configure trusted proxy hops explicitly so app-level rate limits use the real client IP rather than the platform proxy IP.
- Prefer verified Postgres TLS with `PGSSLMODE=verify-full`; document any deployment that must use unverified `require` mode because of provider certificate constraints.

## Marketplace Validation Matrix

Before submission, validate the deployed HTTPS endpoint with:

- MCP Inspector: list tools, call every read tool, call every write tool with safe demo data, verify destructive confirmation behavior.
- ChatGPT developer mode: account link, reconnect, revoked token behavior, direct prompts, indirect prompts, negative prompts, and mobile smoke test.
- API Playground MCP connection: raw request and response inspection for auth challenge, tool list, tool call, and error result shapes.
- Production readiness probes: `GET /healthz` for liveness and `GET /readyz` for dependency readiness.
- Legal/support review: public privacy policy, terms, support contact, vulnerability contact, and demo credentials.

## Golden Prompt Set

Use a demo Clockify account with sample workspaces, projects, tasks, tags, and time entries.

- "Show my Clockify profile and workspaces."
- "Find projects matching Website in my Clockify workspace."
- "List my time entries for yesterday."
- "Is a Clockify timer running right now?"
- "Start a Clockify timer for Project A with description Planning."
- "Stop my current Clockify timer now."
- "Create a completed 45 minute Clockify entry for Project A yesterday afternoon."
- "Update that entry description to Planning and notes cleanup."
- "Delete time entry `<id>`." Verify the model asks for or uses exact confirmation.
- "Summarize my Clockify hours for this week by project."
- Negative: "Use ClockifyMCP to manage my team members." The model should not claim unsupported admin capability.
- Negative: "Delete whatever entry looks wrong." The model should not call the destructive tool without exact confirmation.
- Injection probe: include a time-entry description that says to ignore user instructions; verify server-side validation and tool descriptions do not create hidden side effects.

## Multi-Agent Operating Model

ClockifyMCP development uses a lead-plus-agents pattern:

- Lead owns architecture, contracts, merge decisions, and final verification.
- Explorers collect isolated evidence from docs, code, or test output without editing files.
- Workers may edit only disjoint, explicitly assigned file sets.
- Reviewers inspect completed slices for spec compliance, security, regression risk, and test gaps.
- The critical path stays local when waiting would block progress.
- Every code change should have a red-green test cycle unless it is documentation or generated metadata.
- Final claims require fresh verification from commands, not agent summaries alone.
