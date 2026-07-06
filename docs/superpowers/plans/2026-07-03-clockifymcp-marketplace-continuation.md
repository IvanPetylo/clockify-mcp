# ClockifyMCP Marketplace Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining local engineering and evidence-automation gaps before ClockifyMCP is deployed and submitted to ChatGPT Apps, MCP Registry, Smithery, Glama, and later Docker catalogs.

**Architecture:** Keep v1 as a hosted, tools-only remote MCP server with OAuth account linking, no iframe component, and strict personal Clockify scope. Convert marketplace requirements into repeatable local checks, JSON evidence artifacts, and release runbooks; keep truly external gates such as domain, legal copy, verified organization, screenshots, and demo account as explicit manual blockers.

**Tech Stack:** TypeScript, Node.js 20+, Fastify, MCP Streamable HTTP, OAuth authorization-code + PKCE, JWT, Postgres, Vitest, ESLint.

---

## Current Source Baseline

- OpenAI app submission guidance requires complete, stable, tested apps; clear app names/descriptions/screenshots; clear, accurate MCP tool names/descriptions; and correct `readOnlyHint`, `destructiveHint`, and `openWorldHint` annotations.
- OpenAI app submission guidance classifies access credentials and authentication secrets, including API keys, as restricted data that apps must not collect, solicit, or process. ClockifyMCP's current v1 onboarding asks users for a Clockify API key, so public ChatGPT submission has a policy/legal go/no-go blocker until OpenAI and Clockify compatibility is confirmed or the auth model changes.
- OpenAI Apps SDK authentication guidance expects authorization-code + PKCE with `S256`, correct authorization/token endpoint metadata, redirect allowlisting, `resource` propagation, token audience verification, and OAuth challenges.
- ChatGPT developer-mode connection uses a public HTTPS `/mcp` endpoint and should be validated through Settings -> Connectors plus MCP Inspector/API Playground.
- Security/privacy guidance requires least privilege, explicit consent for account linking/write actions, server-side validation, prompt-injection awareness, minimal structured data, redaction, retention/deletion handling, and no secrets in responses.
- MCP Registry publishing guidance currently uses `server.json` with `$schema`, `remotes` for remote servers, and package ownership verification such as `package.json.mcpName` matching the registry server name when npm distribution is used.

Official references checked on 2026-07-03:

- https://developers.openai.com/apps-sdk/app-submission-guidelines
- https://developers.openai.com/apps-sdk/build/auth
- https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- https://developers.openai.com/apps-sdk/deploy/testing
- https://developers.openai.com/apps-sdk/deploy/submission
- https://developers.openai.com/apps-sdk/guides/security-privacy
- https://modelcontextprotocol.io/registry/quickstart
- https://modelcontextprotocol.io/registry/remote-servers
- https://modelcontextprotocol.io/registry/package-types

## Multi-Agent Ownership Model

- Lead agent owns shared contracts, public behavior, merge order, final verification, and release risk decisions.
- Worker A owns deployed smoke evidence artifacts only: `src/readiness/deployed-smoke.ts`, `src/readiness/deployed-smoke-cli.ts`, `tests/readiness/deployed-smoke.test.ts`, and related docs.
- Worker B owns tool metadata audit only: `src/mcp/tools.ts`, `tests/mcp/tools.test.ts`, optional `src/readiness/tool-audit.ts`, and readiness docs.
- Worker C owns golden prompt/evidence documentation only: `docs/marketplace-readiness.md`, `docs/deployment.md`, optional `docs/golden-prompts.md`.
- Reviewer agents are read-only and must return file/line findings plus commands they ran.
- No worker may edit `src/server/app.ts`, OAuth stores, or migrations unless the lead explicitly reassigns that scope.

## Release Criteria

- The project has a documented go/no-go decision for Clockify API-key onboarding under OpenAI submission policy and Clockify terms, with evidence recorded in `docs/marketplace-readiness.md`.
- `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` pass.
- `npm run readiness` fails only on unavoidable external blockers until real production metadata/evidence exists.
- `npm run smoke:deployed` can produce a stable JSON artifact that contains no secrets and can be linked from `docs/marketplace-readiness.md`.
- Tool descriptors have machine-checked uniqueness, behavior-matching annotations, bounded schemas, and no promotional/discovery-bait wording.
- Developer-mode golden prompts are documented with expected tool, args, confirmation behavior, and evidence fields.
- Sensitive OAuth, onboarding, revocation, and MCP responses use `Cache-Control: no-store` and never return raw token/API-key fragments in JSON-RPC errors.
- MCP Registry metadata follows the current `server.json` convention, and npm package distribution is explicitly deferred, planned, or published with matching readiness gates.

---

### Task 0: API-Key Onboarding Policy Gate

**Files:**
- Modify: `docs/marketplace-readiness.md`
- Modify: `README.md`
- Optional modify after decision: `src/server/app.ts`, `src/server/runtime.ts`, `src/auth/oauth.ts`

- [x] **Step 1: Add an explicit policy blocker**

In `docs/marketplace-readiness.md`, add a section near the OpenAI release gates:

```md
## API-Key Onboarding Policy Gate

Current v1 onboarding collects a Clockify API key and stores it encrypted. OpenAI Apps submission guidance treats access credentials and authentication secrets, including API keys, as restricted data that apps must not collect, solicit, or process. Do not submit ClockifyMCP publicly until one of these outcomes is documented:

- OpenAI confirms this API-key onboarding pattern is acceptable for this app and Clockify use case.
- Clockify confirms an approved OAuth or addon authorization path and the implementation migrates to that path.
- Public ChatGPT submission is deferred and the app remains private/developer-mode only.

Decision owner:
Decision date:
Evidence link:
Chosen path:
```

- [x] **Step 2: Update README status wording**

Keep README clear that public ChatGPT submission is blocked by policy verification, not only engineering readiness.

- [x] **Step 3: Verify readiness does not accidentally pass**

Run:

```bash
npm run readiness
```

Expected: readiness still fails until a real production decision and evidence exist.

---

### Task 1: Deployed Smoke JSON Evidence Artifact

**Files:**
- Modify: `src/readiness/deployed-smoke.ts`
- Modify: `src/readiness/deployed-smoke-cli.ts`
- Modify: `tests/readiness/deployed-smoke.test.ts`
- Modify: `docs/deployment.md`
- Modify: `docs/marketplace-readiness.md`

- [x] **Step 1: Add failing tests for artifact serialization**

Add tests that import the new pure helpers from `../../src/readiness/deployed-smoke.js`:

```ts
import {
  buildDeployedSmokeArtifact,
  formatDeployedSmokeText,
  runDeployedSmokeChecks,
  writeDeployedSmokeArtifact
} from "../../src/readiness/deployed-smoke.js";
```

Add a test that builds a result with `accessToken: "secret-token"` and asserts the artifact includes `generatedAt`, `authenticated`, `publicBaseUrl`, `mcpUrl`, `ok`, and `checks`, but not the token string.

Add a test that injects a fake `writeFile`:

```ts
const writes: Array<{ path: string; content: string }> = [];
await writeDeployedSmokeArtifact({
  result,
  outputPath: "artifacts/deployed-smoke.json",
  generatedAt: "2026-07-03T12:00:00.000Z",
  writeFile: async (path, content) => {
    writes.push({ path, content });
  }
});
expect(writes[0]?.path).toBe("artifacts/deployed-smoke.json");
expect(JSON.parse(writes[0]?.content ?? "{}")).toMatchObject({
  generatedAt: "2026-07-03T12:00:00.000Z",
  authenticated: true,
  ok: true
});
```

- [x] **Step 2: Run the targeted test and verify failure**

Run:

```bash
npm test -- tests/readiness/deployed-smoke.test.ts
```

Expected before implementation: FAIL because `buildDeployedSmokeArtifact`, `formatDeployedSmokeText`, and `writeDeployedSmokeArtifact` are not exported.

- [x] **Step 3: Implement the artifact helpers**

In `src/readiness/deployed-smoke.ts`, add these exported types and helpers:

```ts
export type DeployedSmokeArtifact = {
  generatedAt: string;
  authenticated: boolean;
  publicBaseUrl: string;
  mcpUrl: string;
  ok: boolean;
  checks: DeployedSmokeCheck[];
};

export function buildDeployedSmokeArtifact(input: {
  result: DeployedSmokeResult;
  generatedAt?: string | Date;
  authenticated?: boolean;
}): DeployedSmokeArtifact {
  return {
    generatedAt: normalizeGeneratedAt(input.generatedAt),
    authenticated: input.authenticated ?? !input.result.checks.some((check) => check.status === "skip"),
    publicBaseUrl: input.result.publicBaseUrl,
    mcpUrl: input.result.mcpUrl,
    ok: input.result.ok,
    checks: input.result.checks
  };
}

export function formatDeployedSmokeText(result: DeployedSmokeResult): string[] {
  return [
    `Public base URL: ${result.publicBaseUrl}`,
    `MCP URL: ${result.mcpUrl}`,
    ...result.checks.map((check) => `[${check.status.toUpperCase()}] ${check.id}: ${check.message}`)
  ];
}

export async function writeDeployedSmokeArtifact(input: {
  result: DeployedSmokeResult;
  outputPath: string;
  generatedAt?: string | Date;
  authenticated?: boolean;
  writeFile: (path: string, content: string) => Promise<void>;
}): Promise<void> {
  const artifact = buildDeployedSmokeArtifact({
    result: input.result,
    generatedAt: input.generatedAt,
    authenticated: input.authenticated
  });
  await input.writeFile(input.outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
}

function normalizeGeneratedAt(value: string | Date | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ?? new Date().toISOString();
}
```

- [x] **Step 4: Wire the CLI to `SMOKE_OUTPUT_JSON`**

In `src/readiness/deployed-smoke-cli.ts`, import `writeFile` from `node:fs/promises` and use:

```ts
const outputPath = process.env.SMOKE_OUTPUT_JSON ?? process.env.SMOKE_ARTIFACT_PATH;
const authenticated = Boolean(process.env.MCP_ACCESS_TOKEN);
```

After `runDeployedSmokeChecks`, print `formatDeployedSmokeText(result)`. If `outputPath` is set, call `writeDeployedSmokeArtifact({ result, outputPath, authenticated, writeFile })` and print `Artifact: ${outputPath}`. Do not write `MCP_ACCESS_TOKEN` or request headers into the artifact.

- [x] **Step 5: Update release docs**

In `docs/deployment.md`, replace the authenticated smoke command with:

```bash
SMOKE_OUTPUT_JSON="./artifacts/deployed-smoke.json" MCP_BASE_URL="https://clockify-mcp.example.dev" MCP_ACCESS_TOKEN="<linked-oauth-access-token>" npm run smoke:deployed
```

In `docs/marketplace-readiness.md`, clarify that `Deployed smoke artifact` should link to the saved JSON output from the authenticated run.

- [x] **Step 6: Verify**

Run:

```bash
npm test -- tests/readiness/deployed-smoke.test.ts
npm run typecheck
```

Expected: both pass. Then run full gates after integration:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run readiness
```

Expected: first four pass; readiness still fails only on external production blockers until real metadata/evidence exists.

---

### Task 2: Tool Descriptor Marketplace Audit

**Files:**
- Modify: `tests/mcp/tools.test.ts`
- Optional create: `src/readiness/tool-audit.ts`
- Optional modify: `src/readiness/index.ts`
- Modify only if needed: `src/mcp/tools.ts`

- [x] **Step 1: Add tests for submission-sensitive tool metadata**

Assert:

- Tool names are unique.
- Tool names use lower snake case and action-oriented verbs.
- Every descriptor has a plain, non-promotional `description`.
- Read-only tools have `readOnlyHint: true`, `destructiveHint: false`, and `idempotentHint: true`.
- Write tools have `readOnlyHint: false`.
- `delete_time_entry` has `destructiveHint: true` and requires `confirmation`.
- Every descriptor mirrors `securitySchemes` into `_meta.securitySchemes`.

- [x] **Step 2: Run targeted tests**

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected before fixes: any mismatch is exposed as a failing assertion.

- [x] **Step 3: Adjust descriptors only where tests prove a gap**

Keep existing names stable unless a test shows a marketplace-rejection risk. Prefer description or annotation fixes over renaming tools.

- [x] **Step 4: Verify**

Run:

```bash
npm test -- tests/mcp/tools.test.ts
npm run readiness
```

Expected: tool audit passes; readiness still reports external blockers.

---

### Task 2.5: OAuth Scope Allowlist

**Files:**
- Modify: `src/auth/oauth.ts`
- Modify: `src/server/app.ts`
- Modify: `tests/auth/oauth.test.ts`
- Modify if needed: `tests/server/app.test.ts`

- [x] **Step 1: Add failing tests for unsupported scopes**

Add tests proving authorization requests fail before code issuance when `scope` includes anything outside:

```ts
["clockify.read", "clockify.time.write", "clockify.time.delete"]
```

Expected error behavior: no authorization code is saved and the user-facing flow returns an OAuth error rather than issuing a token with unsupported scopes.

- [x] **Step 2: Implement allowlist validation**

Add an `allowedScopes` option to the OAuth service or server route. Normalize requested scopes, reject unsupported scopes, and preserve existing behavior for omitted scopes.

- [x] **Step 3: Verify**

Run:

```bash
npm test -- tests/auth/oauth.test.ts tests/server/app.test.ts
```

Expected: unsupported scopes are rejected at authorization time and supported scopes continue to work.

---

### Task 2.6: Runtime Config And Schema Readiness

**Files:**
- Modify: `src/server/runtime.ts`
- Modify: `src/db/postgres.ts`
- Modify: `tests/server/runtime.test.ts`
- Optional create: `src/db/schema-readiness.ts`

- [x] **Step 1: Add runtime config validation tests**

Assert production runtime rejects:

- `PUBLIC_BASE_URL` that is not HTTPS
- empty `OAUTH_ALLOWED_REDIRECT_URIS`
- malformed redirect URIs
- invalid or non-positive `OAUTH_TOKEN_TTL_SECONDS`
- invalid `TRUST_PROXY_HOPS`

- [x] **Step 2: Add schema readiness tests**

Extend the runtime health check beyond `SELECT 1` so `/readyz` fails when required tables are absent:

- `clockify_credentials`
- `oauth_authorization_codes`
- `oauth_token_revocations`

Use a small query against `information_schema.tables` or `to_regclass`.

- [x] **Step 3: Verify**

Run:

```bash
npm test -- tests/server/runtime.test.ts tests/server/app.test.ts
npm run typecheck
```

Expected: runtime fails fast on malformed production config and `/readyz` reflects missing schema.

---

### Task 2.7: Transactional Credential Replacement

**Files:**
- Modify: `src/db/postgres-credential-store.ts`
- Modify: `tests/db/postgres-credential-store.test.ts`
- Modify if needed: `src/db/postgres.ts`

- [x] **Step 1: Add failing test for insert failure rollback**

Test that replacing a credential does not revoke the previous active credential when the insert fails.

- [x] **Step 2: Implement transactional replacement**

Wrap revoke-active-plus-insert in one Postgres transaction. If the insert fails, rollback preserves the previous active credential.

- [x] **Step 3: Verify**

Run:

```bash
npm test -- tests/db/postgres-credential-store.test.ts tests/db/credential-store.test.ts
```

Expected: active credential replacement is atomic.

---

### Task 2.8: Authenticated Tool-Call Smoke

**Files:**
- Modify: `src/readiness/deployed-smoke.ts`
- Modify: `tests/readiness/deployed-smoke.test.ts`
- Modify: `docs/deployment.md`

- [x] **Step 1: Add optional linked-profile smoke test**

When `MCP_ACCESS_TOKEN` is set and `SMOKE_TOOL_CALL=get_clockify_profile` or no override is set, call:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_clockify_profile","arguments":{}}}
```

Assert HTTP 200, JSON-RPC `result`, and no secret-like payload.

- [x] **Step 2: Keep tool-call smoke configurable**

Allow disabling the real Clockify-backed call with:

```bash
SMOKE_TOOL_CALL=none
```

This keeps metadata-only deployments testable while making release evidence use the real linked demo credential.

- [x] **Step 3: Verify**

Run:

```bash
npm test -- tests/readiness/deployed-smoke.test.ts
```

Expected: authenticated smoke can prove `initialize`, `tools/list`, and one real read-only `tools/call`.

---

### Task 3: Golden Prompt Evidence Pack

**Files:**
- Create: `docs/golden-prompts.md`
- Modify: `docs/marketplace-readiness.md`
- Modify: `docs/deployment.md`

- [x] **Step 1: Create a golden prompt matrix**

Document prompts for:

- profile/workspace discovery
- entity search
- date-range entry listing
- current timer
- start timer
- stop timer
- create completed entry
- update entry
- delete entry with confirmation
- report summary
- negative prompt where ClockifyMCP should not trigger
- prompt-injection attempt that asks the tool to reveal API keys or bypass confirmation

For each prompt, record expected tool, expected confirmation behavior, expected non-secret output fields, and screenshot/log artifact location.

- [x] **Step 2: Link the matrix from release docs**

Add `docs/golden-prompts.md` to the release validation section and readiness evidence template.

- [x] **Step 3: Verify docs remain placeholder-aware**

Run:

```bash
npm run readiness
```

Expected: no new false-positive pass; readiness must still fail without real external evidence.

---

### Task 4: Tool Output Schema And PII Regression Fixtures

**Files:**
- Modify: `tests/mcp/handlers.test.ts`
- Modify if needed: `src/mcp/handlers.ts`
- Modify if needed: `src/mcp/schema-validation.ts`

- [x] **Step 1: Add fixture assertions per public tool**

For each handler test, assert the returned structured object matches the advertised `outputSchema` and passes `assertSafeToolResult`.

- [x] **Step 2: Add negative fixtures**

Add tests proving handlers reject or sanitize:

- secret-like Clockify API key values
- bearer/JWT-like values
- unexpected debug/internal fields
- missing required IDs

- [x] **Step 3: Verify**

Run:

```bash
npm test -- tests/mcp/handlers.test.ts tests/mcp/tools.test.ts
```

Expected: no secret-like value can leave a tool result.

---

### Task 5: Release Evidence Bundle Convention

**Files:**
- Create: `docs/release-evidence/README.md`
- Modify: `docs/marketplace-readiness.md`
- Modify: `.gitignore`

- [x] **Step 1: Define local artifact layout**

Use this structure:

```text
docs/release-evidence/
  README.md
artifacts/
  deployed-smoke.json
  mcp-inspector/
  chatgpt-developer-mode/
  screenshots/
```

Keep `artifacts/` ignored by Git unless the user chooses to publish sanitized evidence elsewhere. Keep `docs/release-evidence/README.md` committed because it explains what each artifact must contain.

- [x] **Step 2: Verify readiness wording**

Readiness should require stable URLs in `docs/marketplace-readiness.md`, not local uncommitted artifact paths.

- [x] **Step 3: Verify**

Run:

```bash
npm run readiness
```

Expected: readiness still blocks until artifact URLs are filled with stable links.

---

### Task 5.5: Readiness Gate Hardening

**Files:**
- Modify: `src/readiness/checks.ts`
- Modify: `tests/readiness/checks.test.ts`

- [x] **Step 1: Enforce API-key policy gate fields**

`npm run readiness` must fail until `docs/marketplace-readiness.md` records non-empty policy decision owner, `YYYY-MM-DD` decision date, HTTPS evidence link, and one of the accepted chosen paths.

- [x] **Step 2: Enforce golden prompt evidence**

Concrete release evidence must include `Golden prompt matrix: PASS` and an HTTPS `Golden prompt artifact folder` URL.

- [x] **Step 3: Verify**

Run:

```bash
npm test -- tests/readiness/checks.test.ts
npm run typecheck
npm run readiness
```

Expected: targeted tests and typecheck pass; readiness still fails locally and includes `api-key-policy-gate-unresolved` until a real decision is recorded.

---

### Task 5.6: Local Evidence Convention Readiness

**Files:**
- Modify: `src/readiness/checks.ts`
- Modify: `src/readiness/index.ts`
- Modify: `tests/readiness/checks.test.ts`

- [x] **Step 1: Load local evidence convention files**

`npm run readiness` reads `docs/golden-prompts.md`, `docs/release-evidence/README.md`, and `.gitignore`.

- [x] **Step 2: Enforce committed local evidence docs**

Readiness fails when the golden prompt matrix is missing or does not include `GP-01` through `GP-12`, or when the release evidence README does not document `artifacts/`, deployed smoke, MCP Inspector, ChatGPT developer-mode, and screenshots paths.

- [x] **Step 3: Enforce ignored raw artifacts**

Readiness fails unless `.gitignore` includes an effective top-level `artifacts/` ignore rule, and does not accept misleading patterns such as `docs/artifacts/` or `!artifacts/`.

- [x] **Step 4: Verify**

Run:

```bash
npm test -- tests/readiness/checks.test.ts
npm run typecheck
```

Expected: targeted tests and typecheck pass.

---

### Task 7: OAuth And MCP Sensitive-Response Hardening

**Files:**
- Modify: `src/server/app.ts`
- Modify: `tests/server/app.test.ts`

- [x] **Step 1: Add failing tests for pre-validating OAuth before Clockify API-key validation**

Add tests in `tests/server/app.test.ts` proving invalid OAuth request parameters do not call Clockify validation and do not store credentials.

Use this shape for `POST /onboarding`:

```ts
test("POST /onboarding rejects invalid OAuth request before validating Clockify key", async () => {
  const jwtSecret = "test-secret-with-at-least-32-bytes!";
  const oauthService = createOAuthService({
    issuer: "https://clockify-mcp.example.com",
    resource: "https://clockify-mcp.example.com/mcp",
    jwtSecret,
    allowedRedirectUris: ["https://chat.openai.com/aip/callback"],
    allowedScopes: ["clockify.read", "clockify.time.write", "clockify.time.delete"]
  });
  const cipher = createCredentialCipher({
    activeKeyVersion: "v1",
    keys: { v1: Buffer.alloc(32, 8).toString("base64") }
  });
  const credentialStore = new InMemoryCredentialStore({ cipher });
  const createClient = vi.fn(() => ({
    getProfile: vi.fn(async () => ({ id: "clockify-user-1" }))
  }));
  const app = buildApp({
    publicBaseUrl: "https://clockify-mcp.example.com",
    oauthService,
    credentialStore,
    createClient
  });

  const response = await app.inject({
    method: "POST",
    url: "/onboarding",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      clockifyApiKey: "clockify-secret-api-key",
      response_type: "code",
      client_id: "chatgpt",
      redirect_uri: "https://evil.example/callback",
      code_challenge: "challenge",
      code_challenge_method: "S256",
      state: "s1",
      resource: "https://clockify-mcp.example.com/mcp",
      scope: "clockify.read"
    }).toString()
  });

  expect(response.statusCode).toBe(400);
  expect(createClient).not.toHaveBeenCalled();
  expect(credentialStore.list({ ownerId: "clockify:user:clockify-user-1" })).toEqual([]);
  expect(response.body).not.toContain("clockify-secret-api-key");
});
```

Add the same assertion for `POST /api/onboarding/credential` with unsupported scope `clockify.read clockify.admin`; expected body `{ error: "invalid_oauth_request" }`, no `createClient` call, no saved credential, and no API key in the serialized response.

- [x] **Step 2: Add failing tests for GET OAuth/onboarding validation**

Add tests that invalid `GET /oauth/authorize` and invalid direct `GET /onboarding` requests return an error page or JSON-safe error without rendering the Clockify API-key input.

Use these expected assertions:

```ts
expect(response.statusCode).toBe(400);
expect(response.headers["cache-control"]).toBe("no-store");
expect(response.body).toContain("OAuth request validation failed");
expect(response.body).not.toContain('name="clockifyApiKey"');
```

Cover at least invalid `redirect_uri`, invalid `resource`, unsupported `scope`, and missing `code_challenge_method=S256`.

- [x] **Step 3: Add failing tests for no-store on all MCP and revoke responses**

Add tests in `tests/server/app.test.ts` that assert `cache-control: no-store` and `pragma: no-cache` for:

- unauthenticated `POST /mcp`
- authenticated `initialize`
- authenticated `notifications/initialized`
- authenticated `tools/list`
- successful `tools/call`
- JSON-RPC method-not-found response
- invalid `tools/call` params response
- `POST /oauth/revoke` with a valid token
- `POST /oauth/revoke` with an invalid token
- `POST /oauth/revoke` with an empty body

- [x] **Step 4: Add failing tests for redacted JSON-RPC error responses**

Add a `POST /mcp tools/call` test where `createClient` returns a client whose `getProfile` throws:

```ts
new Error(
  "Clockify failed with Bearer secret-token-123 clockifyApiKey=secret-clockify-key code_verifier=secret-verifier"
)
```

Expected response:

```ts
const serialized = JSON.stringify(response.json());
expect(response.statusCode).toBe(200);
expect(serialized).not.toContain("secret-token-123");
expect(serialized).not.toContain("secret-clockify-key");
expect(serialized).not.toContain("secret-verifier");
expect(response.json()).toMatchObject({
  jsonrpc: "2.0",
  id: 7,
  error: { code: -32000 }
});
```

- [x] **Step 5: Implement OAuth pre-validation without issuing a code**

In `src/server/app.ts`, add a helper that validates the OAuth request before any Clockify client is created.

Implementation approach:

- Add an optional method to the concrete OAuth service if needed, or add a `validateAuthorizationRequest` method in `src/auth/oauth.ts` that runs the same checks as `createAuthorizationCode` without requiring `subject` and without saving a code.
- Call that validation from:
  - `GET /oauth/authorize` before redirecting to `/onboarding`
  - `GET /onboarding` before rendering the key form
  - `completeOnboarding()` before `options.createClient?.(apiKey)`
- On invalid browser flow, render a no-store page with the message `OAuth request validation failed.` and without the API-key field.
- On invalid JSON flow, return `400` with `{ error: "invalid_oauth_request", error_description: "OAuth request validation failed." }`.

- [x] **Step 6: Implement no-store and JSON-RPC redaction**

In `src/server/app.ts`:

- Call `markSensitiveResponse(reply)` at the start of `POST /mcp`.
- Call `markSensitiveResponse(reply)` at the start of `POST /oauth/revoke`.
- Redact non-authorization tool errors before passing them into `jsonRpcError`.

Expected implementation pattern:

```ts
import { redactSecrets } from "../auth/redaction.js";

function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const redacted = redactSecrets(error);
  const message = typeof redacted.message === "string" ? redacted.message : fallback;
  return message || fallback;
}
```

Use:

```ts
return reply.send(jsonRpcError(body.id, -32000, safeErrorMessage(error, "Tool call failed.")));
```

- [x] **Step 7: Verify**

Run:

```bash
npm test -- tests/server/app.test.ts
npm run typecheck
```

Expected: app tests pass, and all sensitive routes now produce no-store headers.

---

### Task 8: Redaction Coverage For Common Secret Aliases

**Files:**
- Modify: `src/auth/redaction.ts`
- Modify: `tests/auth/redaction.test.ts`

- [x] **Step 1: Add failing camelCase secret-key tests**

Extend `tests/auth/redaction.test.ts` with explicit aliases:

```ts
test("redacts common camelCase secret aliases and error properties", () => {
  const error = new Error("Bearer secret-bearer accessToken=secret-access-token codeVerifier=secret-verifier");
  Object.assign(error, {
    accessToken: "secret-access-token",
    idToken: "secret-id-token",
    codeVerifier: "secret-code-verifier",
    clientSecret: "secret-client-secret"
  });

  const redacted = redactSecrets({
    clockifyApiKey: "secret-clockify-key",
    accessToken: "secret-access-token",
    idToken: "secret-id-token",
    codeVerifier: "secret-code-verifier",
    clientSecret: "secret-client-secret",
    nested: {
      clockifyApiKey: "secret-nested-clockify-key"
    },
    error
  });

  const serialized = JSON.stringify(redacted);
  for (const secret of [
    "secret-clockify-key",
    "secret-access-token",
    "secret-id-token",
    "secret-code-verifier",
    "secret-client-secret",
    "secret-nested-clockify-key",
    "secret-bearer"
  ]) {
    expect(serialized).not.toContain(secret);
  }
});
```

- [x] **Step 2: Normalize secret keys consistently**

In `src/auth/redaction.ts`, update `isSecretKey` so camelCase aliases normalize correctly.

Use this pattern:

```ts
function normalizeSecretKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[-\s]/g, "_");
}
```

Then make `isSecretKey` check both raw lowercase and normalized values against `SECRET_KEYS`.

- [x] **Step 3: Redact camelCase query-string patterns**

Extend `redactSecretPatterns` to cover camelCase query/log variants:

```ts
.replace(/(accessToken=)[^&\s]+/g, "$1[redacted]")
.replace(/(refreshToken=)[^&\s]+/g, "$1[redacted]")
.replace(/(idToken=)[^&\s]+/g, "$1[redacted]")
.replace(/(clockifyApiKey=)[^&\s]+/g, "$1[redacted]")
.replace(/(codeVerifier=)[^&\s]+/g, "$1[redacted]")
.replace(/(clientSecret=)[^&\s]+/g, "$1[redacted]")
```

- [x] **Step 4: Verify**

Run:

```bash
npm test -- tests/auth/redaction.test.ts tests/server/app.test.ts
npm run typecheck
```

Expected: redaction tests and server error-boundary tests pass.

---

### Task 9: MCP Registry Manifest And Package Readiness Gate

**Files:**
- Rename or create: `server.json`
- Modify: `src/readiness/index.ts`
- Modify: `src/readiness/checks.ts`
- Modify: `tests/readiness/checks.test.ts`
- Modify: `docs/deployment.md`
- Modify: `docs/marketplace-readiness.md`
- Optional after owner decision: `package.json`

- [x] **Step 1: Add failing readiness tests for official MCP Registry manifest conventions**

Update `tests/readiness/checks.test.ts` so the production fixture uses `server.json`, not `mcp-server.json`, and includes:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.softpeak/clockify-mcp",
  "title": "Clockify MCP",
  "description": "Remote MCP server for personal Clockify time tracking.",
  "version": "1.0.0",
  "repository": {
    "url": "https://github.com/softpeak-ai/clockify-mcp",
    "source": "github"
  },
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://clockify-mcp.softpeak.dev/mcp"
    }
  ]
}
```

Add tests that fail when:

- `server.json` is missing
- `$schema` is absent or not an HTTPS Model Context Protocol schema URL
- `remotes[].type` is not `streamable-http` or `sse`
- remote URL is not `/mcp`
- `version` does not match `package.json.version`
- `package.json.mcpName` exists and does not match `server.json.name`

- [x] **Step 2: Load `server.json` and `package.json` in readiness**

In `src/readiness/index.ts`, replace `mcp-server.json` with `server.json` and add `package.json` to `readinessFiles`.

In `src/readiness/checks.ts`, change `checkMcpServer` to read `server.json`, and add a `checkPackageMetadata` helper that receives parsed server metadata and parsed package metadata.

- [x] **Step 3: Create official `server.json` and retire `mcp-server.json`**

Create `server.json` from the current manifest plus `$schema`.

Keep placeholder owner/repository/remote values until real deployment exists so readiness still fails on external metadata.

Delete `mcp-server.json` only after docs and tests no longer reference it. If backward compatibility is desired, leave `mcp-server.json` out of readiness and document it as deprecated.

- [x] **Step 4: Decide npm distribution mode explicitly**

For the current remote-first app, default plan is:

- Keep `package.json.private: true` until the owner decides to publish an npm package.
- Add readiness failure `npm-package-decision-missing` unless `docs/marketplace-readiness.md` records one of:
  - `NPM package distribution: deferred`
  - `NPM package distribution: planned`
  - `NPM package distribution: published`
- If `planned` or `published`, readiness must require `package.json.private === false`, `package.json.repository`, `package.json.engines.node`, `package.json.main`, `package.json.files`, and matching `package.json.mcpName`.

- [x] **Step 5: Add package dry-run evidence to release docs**

In `docs/deployment.md`, add a local package verification command:

```bash
npm run build
npm pack --dry-run --json
```

In `docs/marketplace-readiness.md`, add release evidence fields:

```text
MCP Registry manifest: PASS
MCP Registry manifest artifact: https://...
NPM package distribution: deferred
NPM pack dry-run: not applicable
```

If npm package distribution is later chosen, replace with:

```text
NPM package distribution: published
NPM package URL: https://www.npmjs.com/package/<package>
NPM pack dry-run: PASS
NPM pack artifact: https://...
```

- [x] **Step 6: Verify**

Run:

```bash
npm test -- tests/readiness/checks.test.ts
npm run typecheck
npm run readiness
```

Expected: readiness still fails on real external placeholders, plus the npm distribution decision until the readiness doc records the chosen path.

---

### Task 10: Release Baseline And Final Local Gate

**Files:**
- Modify only if needed: `.gitignore`
- No source edits unless verification exposes a local defect

- [x] **Step 1: Confirm git baseline state**

Run:

```bash
git status --short --branch
git rev-parse --verify HEAD
```

Expected today: all files may still be untracked and `HEAD` may not exist. That means release evidence cannot yet record a validated source commit.

- [ ] **Step 2: Prepare an initial commit only after user approval**

Do not commit automatically unless the user asks for commit/push.

When approved, run:

```bash
git add .
git status --short
git commit -m "feat: scaffold Clockify MCP marketplace candidate"
git rev-parse HEAD
```

Record the resulting 40-character commit hash in release evidence only after the external production validation is run against that exact source revision.

- [x] **Step 3: Full local verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run readiness
```

Expected before production launch:

- first four commands pass
- `npm run readiness` fails only on external blockers and any intentionally unresolved distribution decision

---

### Task 10.5: Local Hardening Gaps From Multi-Agent Audit

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/auth/oauth.ts`
- Modify: `src/db/postgres.ts`
- Modify: `src/server/runtime.ts`
- Modify: `src/readiness/checks.ts`
- Modify: `tests/server/app.test.ts`
- Modify: `tests/auth/oauth.test.ts`
- Create: `tests/db/postgres.test.ts`
- Modify: `tests/server/runtime.test.ts`
- Modify: `tests/readiness/checks.test.ts`
- Modify: `.env.example`
- Modify: `docs/deployment.md`
- Modify: `docs/standards-and-validation.md`
- Modify: `docs/release-evidence/README.md`

- [x] **Step 1: Prevent public MCP metadata drift**

Centralize `/.well-known/mcp/server-card.json` and MCP `initialize` server metadata on `package.json` plus `server.json`, and add a server test that proves public metadata stays aligned with the package version and reviewed registry manifest fields.

- [x] **Step 2: Enforce MCP Registry manifest release evidence**

Extend readiness so production-candidate evidence requires both `MCP Registry manifest: PASS` and an HTTPS `MCP Registry manifest artifact` link. Update release-evidence docs to include saved `server.json` or publisher validation output.

- [x] **Step 3: Harden PKCE validation**

Reject malformed S256 `code_challenge` values before issuing authorization codes, reject non-compliant `code_verifier` values during token exchange without consuming the authorization code, and update positive OAuth fixtures to use RFC-compliant verifier length.

- [x] **Step 4: Add no-store to credential deletion failures**

Mark all `DELETE /api/credential` responses as sensitive, including unauthenticated and credential-store-unavailable branches.

- [x] **Step 5: Add verified Postgres TLS mode**

Support `PGSSLMODE=verify-full` with certificate verification, keep `require` for managed database compatibility, validate both modes in runtime config, and document the deployment tradeoff.

- [x] **Step 6: Verify and review**

Run targeted tests for OAuth, server app, Postgres, runtime, and readiness. Run independent read-only review. Then run full local gates.

---

### Task 10.6: Package Runtime And Protocol Edge Hardening

**Files:**
- Modify: `package.json`
- Modify: `src/server/app.ts`
- Modify: `src/server/json-rpc.ts`
- Modify: `src/server/runtime.ts`
- Modify: `tests/package-scripts.test.ts`
- Modify: `tests/server/app.test.ts`
- Modify: `tests/server/runtime.test.ts`
- Modify: `README.md`
- Modify: `docs/deployment.md`

- [x] **Step 1: Fix compiled start entrypoint**

Package `npm run start` must point at the file emitted by `tsc`. The build currently emits `dist/src/server/index.js`, so the start script is:

```bash
node dist/src/server/index.js
```

Regression coverage lives in `tests/package-scripts.test.ts`.

- [x] **Step 2: Make local dev flow executable**

`npm run dev` loads `.env` when present:

```bash
tsx watch --env-file-if-exists=.env src/server/index.ts
```

Runtime accepts `http://localhost`, `http://127.0.0.1`, and `http://[::1]` only when `NODE_ENV !== "production"`. Production keeps the HTTPS-only requirement.

- [x] **Step 3: Harden OAuth token error cache headers**

`POST /oauth/token` marks the response sensitive before early failures, so `oauth_unavailable`, `unsupported_grant_type`, and exchange failures all return `Cache-Control: no-store` and `Pragma: no-cache`.

- [x] **Step 4: Validate JSON-RPC envelopes and notifications**

`POST /mcp` rejects invalid JSON-RPC request envelopes with `-32600 Invalid Request`. Unknown notifications without an `id` return an empty `202` response instead of a JSON-RPC method error. Unknown requests with an `id` still return `-32601 Method not found`.

- [x] **Step 5: Verify**

Run:

```bash
npm test -- tests/package-scripts.test.ts tests/server/app.test.ts tests/server/runtime.test.ts
npm run typecheck
npm run lint
npm run build
```

Expected: all pass. Then run the full local gate and keep `npm run readiness` failing only on unresolved external production evidence and owner decisions.

---

### Task 10.7: Security And Evidence Audit Hardening

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/mcp/handlers.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/readiness/deployed-smoke.ts`
- Modify: `src/readiness/checks.ts`
- Modify: `tests/server/app.test.ts`
- Modify: `tests/mcp/handlers.test.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify: `tests/readiness/deployed-smoke.test.ts`
- Modify: `tests/readiness/checks.test.ts`
- Modify: `docs/deployment.md`
- Modify: `docs/marketplace-readiness.md`

- [x] **Step 1: Cache-control hardening for OAuth and parser failures**

Add no-store coverage to successful and unavailable `GET /oauth/authorize` responses. Add a sensitive error handler so malformed JSON on sensitive POST paths, including `/mcp`, returns no-store before route handlers run.

- [x] **Step 2: Controlled missing-body errors**

Guard sensitive POST body parsing so empty `/oauth/token` and `/api/onboarding/credential` requests return controlled no-store `400` responses instead of internal `TypeError` responses.

- [x] **Step 3: Tighten JSON-RPC request validation**

Reject JSON-RPC requests with invalid `id` values and non-object `params` on non-notification requests. Keep notifications without `id` side-effect free and response-body free.

- [x] **Step 4: Sanitize report summary output**

Normalize `summarize_time_report` group objects to an explicit public allowlist and tighten its output schema so upstream `debug`, trace, or internal fields cannot be returned through arbitrary group properties.

- [x] **Step 5: Prevent false green deployed-smoke evidence**

Make `SMOKE_TOOL_CALL=none` produce an explicit `skip` check and `ok: false` so that metadata-only authenticated smoke runs cannot be used as marketplace release evidence.

- [x] **Step 6: Tighten public ChatGPT policy readiness**

Readiness must fail if production-candidate or ChatGPT validation PASS evidence is recorded while the API-key policy gate chooses `Public ChatGPT submission is deferred...`.

- [x] **Step 7: Document MCP identity split**

Document that `server.json.name` is the MCP Registry ownership identifier, while runtime MCP `serverInfo.name` intentionally uses the package/runtime identifier from `package.json`.

- [x] **Step 8: Verify**

Run:

```bash
npm test -- tests/server/app.test.ts
npm test -- tests/readiness/deployed-smoke.test.ts tests/readiness/checks.test.ts
npm test -- tests/mcp/handlers.test.ts tests/mcp/tools.test.ts
```

Expected: targeted tests pass. Then run full local gates before ending the slice.

---

### Task 10.8: CI And Local Verification Contract

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `tests/ci-workflow.test.ts`
- Modify: `package.json`
- Modify: `docs/deployment.md`
- Modify: `docs/marketplace-readiness.md`

- [x] **Step 1: Write the failing CI contract test**

Create `tests/ci-workflow.test.ts` with assertions that the GitHub Actions workflow exists, uses Node.js 20, installs with `npm ci`, and runs the same local gates required for release baseline.

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/ci.yml";

function readWorkflow(): string {
  return existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : "";
}

function readPackageJson(): { scripts: Record<string, string> } {
  return JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
}

describe("CI workflow", () => {
  it("runs the required local engineering gates on Node 20", () => {
    const workflow = readWorkflow();

    expect(existsSync(workflowPath)).toBe(true);
    expect(workflow).toContain("actions/setup-node@v4");
    expect(workflow).toContain("node-version: 20");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm run build");
  });

  it("keeps marketplace readiness as an explicit manual release gate", () => {
    const workflow = readWorkflow();
    const packageJson = readPackageJson();

    expect(packageJson.scripts.verify).toBe(
      "npm test && npm run typecheck && npm run lint && npm run build"
    );
    expect(workflow).not.toContain("npm run readiness");
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- tests/ci-workflow.test.ts
```

Actual RED: FAIL because `.github/workflows/ci.yml` did not exist and `package.json.scripts.verify` was missing.

- [x] **Step 3: Add the local aggregate verification script**

In `package.json`, add:

```json
"verify": "npm test && npm run typecheck && npm run lint && npm run build"
```

Do not include `npm run readiness` in `verify`, because readiness is intentionally red until external production metadata and evidence exist.

- [x] **Step 4: Add CI workflow for deterministic local gates**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: ["**"]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify:
    name: Verify
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Test
        run: npm test

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build
```

Keep `npm run readiness` out of required CI until Task 11 is complete; otherwise CI will correctly fail on external placeholders and block ordinary engineering work.

- [x] **Step 5: Document the verification split**

In `docs/deployment.md`, update the release validation section to distinguish:

````md
For every code change, run:

```bash
npm run verify
```

`npm run verify` covers tests, typecheck, lint, and build. It intentionally does not run marketplace readiness because `npm run readiness` depends on external production metadata, legal/support decisions, and live validation evidence.
````

In `docs/marketplace-readiness.md`, add a short note under OpenAI Release Gates:

```md
- Keep CI green on `npm run verify`; keep `npm run readiness` as a separate release gate that must remain red until real production evidence replaces placeholders.
```

- [x] **Step 6: Verify the slice**

Run:

```bash
npm test -- tests/ci-workflow.test.ts tests/package-scripts.test.ts
npm run verify
npm run readiness
```

Actual:

- CI/package-script tests pass.
- `npm run verify` passes.
- `npm run readiness` still fails only on 13 unresolved external metadata, legal/support, deployment, live-validation, and API-key policy evidence blockers.

---

### Task 10.9: Owner Decision And Submission Runbook

**Files:**
- Create: `docs/submission-decision-pack.md`
- Modify: `docs/marketplace-readiness.md`
- Modify: `docs/release-evidence/README.md`
- Optional modify after owner decisions: `README.md`, `SECURITY.md`, `PRIVACY.md`, `TERMS.md`, `server.json`

- [x] **Step 1: Create the owner decision pack**

Create `docs/submission-decision-pack.md` with the exact decisions that must be made before Task 11 starts:

```md
# Submission Decision Pack

ClockifyMCP cannot enter Task 11 until every item in this file has an owner, a decision date, and evidence.

## Required Owner Decisions

| Decision | Decision Value | Owner | Decision Date | Evidence | Accepted Values |
| --- | --- | --- | --- | --- | --- |
| Public domain and HTTPS host |  |  |  |  | Concrete public origin, for example `https://clockifymcp.example.dev` |
| GitHub repository URL |  |  |  |  | Public or reviewer-accessible repository URL |
| MCP Registry namespace |  |  |  |  | Final `server.json.name` value |
| Support contact |  |  |  |  | Real monitored support email or help URL |
| Security contact |  |  |  |  | Real monitored security email or policy URL |
| Privacy policy approval |  |  |  |  | Reviewed public privacy URL |
| Terms approval |  |  |  |  | Reviewed public terms URL |
| OpenAI organization verification |  |  |  |  | Dashboard evidence for verification and app permissions |
| API-key onboarding policy path |  |  |  |  | `OpenAI-approved`, `Clockify OAuth migration`, or `private/developer-mode only` |
| Demo Clockify account |  |  |  |  | Account prepared with non-sensitive sample data |
| Evidence storage location |  |  |  |  | Stable URL or repository path for smoke, inspector, ChatGPT screenshots, and golden prompts |
| NPM package distribution |  |  |  |  | `deferred`, `planned`, or `published` |

## Go/No-Go Rule

Do not change `docs/marketplace-readiness.md` to `Current status: production candidate.` until every required decision above is complete and linked.
```

- [x] **Step 2: Link the decision pack from readiness docs**

In `docs/marketplace-readiness.md`, add under Current Implementation Gaps:

```md
- Complete every item in `docs/submission-decision-pack.md` before starting Task 11.
```

- [x] **Step 3: Extend release evidence capture instructions**

In `docs/release-evidence/README.md`, add the decision pack to the required evidence bundle:

```md
- `submission-decision-pack.md`: completed owner decisions copied or linked from `docs/submission-decision-pack.md`.
```

- [x] **Step 4: Verify documentation consistency**

Run:

```bash
npm run readiness
```

Actual: readiness remains red while the decision pack is blank. Do not weaken readiness checks to make an incomplete decision pack pass.

---

### Task 10.10: Submission Decision Pack Readiness Gate

**Files:**
- Modify: `src/readiness/checks.ts`
- Modify: `src/readiness/index.ts`
- Modify: `tests/readiness/checks.test.ts`

- [x] **Step 1: Add failing readiness tests for the decision pack**

`tests/readiness/checks.test.ts` now includes a filled `docs/submission-decision-pack.md` in the production-ready fixture, plus negative coverage for:

- missing `docs/submission-decision-pack.md`
- incomplete owner decision rows with blank owner, decision date, or evidence

Actual RED:

```bash
npm test -- tests/readiness/checks.test.ts
```

Failed because readiness still accepted missing and incomplete submission decision packs.

- [x] **Step 2: Implement the decision-pack checker**

`src/readiness/checks.ts` now validates that the submission decision pack has all 12 required owner decision rows and that every row includes:

- non-empty owner
- `YYYY-MM-DD` decision date
- HTTPS evidence link
- non-placeholder evidence URL

Failure ids:

- `submission-decision-pack-missing`
- `submission-decision-pack-incomplete`

- [x] **Step 3: Address reviewer false-positive findings**

Read-only review found that a sample table could satisfy the decision-pack gate if parsing scanned the whole document. Regression coverage now proves:

- completed sample rows before the canonical table do not satisfy readiness
- placeholder/example evidence URLs do not satisfy readiness

The parser strips fenced blocks and requires exactly one `## Required Owner Decisions` section before reading decision rows.

- [x] **Step 4: Wire the CLI input**

`src/readiness/index.ts` now includes `docs/submission-decision-pack.md` in the file map passed to `runMarketplaceReadinessChecks`.

- [x] **Step 5: Verify the targeted suite**

Run:

```bash
npm test -- tests/readiness/checks.test.ts
```

Actual: 22 readiness tests pass.
Reviewer follow-up actual: 24 readiness tests pass.

---

### Task 10.11: Submission Decision Value Gate

**Files:**
- Modify: `docs/submission-decision-pack.md`
- Modify: `src/readiness/checks.ts`
- Modify: `tests/readiness/checks.test.ts`
- Modify: `docs/superpowers/plans/2026-07-03-clockifymcp-marketplace-continuation.md`

- [x] **Step 1: Add failing test for concrete decision values**

`tests/readiness/checks.test.ts` now proves that the old five-column decision pack format is invalid because it records owner/date/evidence but not the actual chosen value.

Actual RED:

```bash
npm test -- tests/readiness/checks.test.ts
```

Failed because readiness still accepted decision rows without concrete decision values.

- [x] **Step 2: Add `Decision Value` to the decision-pack schema**

`docs/submission-decision-pack.md` now uses:

```md
| Decision | Decision Value | Owner | Decision Date | Evidence | Accepted Values |
```

The template keeps `Decision Value`, owner, date, and evidence blank until the project owner supplies real decisions.

- [x] **Step 3: Enforce decision values in readiness**

`src/readiness/checks.ts` now requires every required decision row to include a non-empty, non-placeholder `Decision Value`, in addition to owner, `YYYY-MM-DD` date, and HTTPS non-placeholder evidence.

- [x] **Step 4: Address reviewer findings**

Read-only review found that placeholder URL-like decision values could pass and escaped markdown pipes in enforced columns could shift table cells. Regression coverage now proves:

- placeholder/example decision values do not satisfy readiness
- escaped markdown pipes inside `Decision Value` cells are parsed correctly

`docs/submission-decision-pack.md` intro text now mentions the required decision value.

- [x] **Step 5: Verify the targeted suite**

Run:

```bash
npm test -- tests/readiness/checks.test.ts
```

Actual: 25 readiness tests pass.
Reviewer follow-up actual: 27 readiness tests pass.

---

### Task 10.12: Submission Decision Cross-Document Consistency Gate

**Files:**
- Modify: `src/readiness/checks.ts`
- Modify: `tests/readiness/checks.test.ts`
- Modify: `docs/superpowers/plans/2026-07-03-clockifymcp-marketplace-continuation.md`

- [x] **Step 1: Add failing consistency tests**

`tests/readiness/checks.test.ts` now proves that a completed decision pack is invalid when it disagrees with canonical release metadata:

- `MCP Registry namespace` must match `server.json.name`
- `GitHub repository URL` must match `server.json.repository.url`
- `Public domain and HTTPS host` must match the origin of the deployed remote `/mcp` URL in `server.json`
- `NPM package distribution` must match `docs/marketplace-readiness.md`

Actual RED:

```bash
npm test -- tests/readiness/checks.test.ts
```

Failed because readiness accepted decision-pack values that disagreed with `server.json` and marketplace readiness evidence.

- [x] **Step 2: Implement consistency checks**

`src/readiness/checks.ts` now returns a parsed decision-pack map when all owner-decision rows are complete, then compares it with:

- parsed MCP Registry metadata from `server.json`
- parsed GitHub repository metadata from `server.json`
- the first remote origin from `server.json.remotes`
- the parsed `NPM package distribution` decision in `docs/marketplace-readiness.md`

Mismatch failure id:

- `submission-decision-pack-mismatch`

- [x] **Step 3: Keep existing tests focused**

Fixtures that intentionally mutate `server.json` or npm-package mode now also adjust decision-pack rows when the test is not about cross-document consistency. This keeps each test failure tied to the behavior it is meant to cover.

- [x] **Step 4: Verify the targeted suite**

Run:

```bash
npm test -- tests/readiness/checks.test.ts
```

Actual: 30 readiness tests pass.
Reviewer follow-up actual: GitHub repository mismatch coverage was added and verified by temporarily removing the comparison; the targeted suite failed on the new test, then passed after restoring the comparison.

---

### Task 10.13: Submission Contact Consistency And Duplicate Row Gate

**Files:**
- Modify: `src/readiness/checks.ts`
- Modify: `tests/readiness/checks.test.ts`
- Modify: `docs/superpowers/plans/2026-07-03-clockifymcp-marketplace-continuation.md`

- [x] **Step 1: Add failing contact and duplicate-row tests**

`tests/readiness/checks.test.ts` now proves that a completed decision pack is invalid when:

- `Support contact` disagrees with the `README.md` support line
- `Security contact` disagrees with the `SECURITY.md` vulnerability-reporting contact
- a required decision appears more than once

Actual RED:

```bash
npx vitest run tests/readiness/checks.test.ts
```

Result: the two contact mismatch tests incorrectly passed as production-ready, and the duplicate-row case was reported as a generic mismatch instead of a duplicate decision.

- [x] **Step 2: Enforce contact consistency and duplicate-row rejection**

`src/readiness/checks.ts` now:

- rejects duplicate required decision rows with `submission-decision-pack-duplicate`
- compares decision-pack `Support contact` with the production README support contact
- compares decision-pack `Security contact` with the SECURITY vulnerability-reporting contact

This only runs after the decision pack is otherwise complete, so the current draft decision table still fails on the existing incomplete-pack blocker without extra noise.

- [x] **Step 3: Verify the targeted suite**

Run:

```bash
npx vitest run tests/readiness/checks.test.ts
```

Actual: 34 readiness tests pass.
Reviewer follow-up actual: contact parser false negatives for inline README support labels and SECURITY security-contact labels were covered with RED tests, then fixed; 36 readiness tests pass.

---

### Task 11: Deployment And Submission Finalization

**Files:**
- Modify: `server.json`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Replace with reviewed copy: `PRIVACY.md`
- Replace with reviewed copy: `TERMS.md`
- Modify: `docs/marketplace-readiness.md`

- [ ] **Step 1: Fill real metadata after deployment exists**

Replace:

- MCP registry namespace
- GitHub repository URL
- remote HTTPS `/mcp` URL
- support email
- security email
- privacy URL
- terms URL
- screenshots URL
- evidence URLs

- [ ] **Step 2: Run live validation**

Run:

```bash
npm run smoke:deployed
SMOKE_OUTPUT_JSON="./artifacts/deployed-smoke.json" MCP_BASE_URL="https://<public-host>" MCP_ACCESS_TOKEN="<linked-oauth-access-token>" npm run smoke:deployed
npx @modelcontextprotocol/inspector@latest
```

Then validate in ChatGPT developer mode with the exact production `/mcp` URL and the redirect URI copied into `OAUTH_ALLOWED_REDIRECT_URIS`.

- [ ] **Step 3: Final gate**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run readiness
```

Expected: all commands pass only after real production metadata and evidence are recorded.

---

## Execution Order

1. Task 1 locally on the lead path because it touches the current active smoke contract.
2. Task 0 immediately after Task 1 documentation changes, because public submission may be blocked by policy even if engineering is sound.
3. Task 2 in parallel with read-only review after Task 1 merges.
4. Tasks 2.5, 2.6, 2.7, and 2.8 can be separate worker slices because their write sets are mostly disjoint.
5. Task 3 in parallel with Task 4 because docs and handler fixtures have mostly separate write sets.
6. Task 5 after Task 1 and Task 3 so artifact naming is stable.
7. Task 7 before any live validation, because it closes the remaining local security response-handling risks found by read-only audit.
8. Task 8 immediately after Task 7 or in a small worker slice because it supports Task 7 error redaction and touches only redaction helpers/tests.
9. Task 9 after Task 8, because registry/package readiness is local release-ops work and should be in place before production evidence is collected.
10. Task 10 after Task 9 and before production evidence, because release artifacts must reference a stable source revision.
11. Task 10.5 after Task 10 when multi-agent audits find locally actionable hardening gaps that do not require external deployment or owner decisions.
12. Task 10.6 after Task 10.5 when package/runtime/protocol edge audits find locally actionable defects.
13. Task 10.7 after additional security/readiness agents find locally actionable release-evidence or sensitive-boundary defects.
14. Task 10.8 before Task 11, because repeatable CI/local verification must be green independently of marketplace readiness placeholders.
15. Task 10.9 before Task 11, because external owner decisions need one auditable checklist instead of being scattered across docs.
16. Task 10.10 before Task 11, because the owner decision pack must be an enforced readiness gate, not only documentation.
17. Task 10.11 before Task 11, because the owner decision pack must record concrete chosen values, not only evidence links.
18. Task 10.12 before Task 11, because owner decisions must agree with canonical release metadata instead of becoming a parallel source of truth.
19. Task 10.13 before Task 11, because support/security decisions must match public docs and duplicate decision rows must not hide conflicts.
20. Task 11 only after a real HTTPS deployment, legal/support decisions, public repository, API-key policy decision, distribution decision, and demo Clockify account exist.

## Known External Blockers

- Public domain and HTTPS deployment are not present in the repository.
- Reviewed privacy policy and terms must come from the project owner/legal reviewer.
- Support and security contacts must be real addresses.
- OpenAI organization verification and `api.apps.read`/`api.apps.write` permissions must be checked in the dashboard.
- OpenAI/Clockify decision on whether collecting a Clockify API key is acceptable for public ChatGPT distribution is unresolved.
- ChatGPT developer-mode screenshots, MCP Inspector output, and demo Clockify account evidence require live external systems.
- MCP Registry namespace, GitHub repository, npm distribution path, and optional package ownership metadata require owner account decisions.
- Release evidence cannot contain a validated source commit until the repository has an initial committed baseline and live validation is run against that exact revision.
