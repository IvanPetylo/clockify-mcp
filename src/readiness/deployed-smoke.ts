export type DeployedSmokeCheckStatus = "pass" | "fail" | "skip";

export type DeployedSmokeCheck = {
  id: string;
  status: DeployedSmokeCheckStatus;
  message: string;
};

export type DeployedSmokeResult = {
  ok: boolean;
  publicBaseUrl: string;
  mcpUrl: string;
  checks: DeployedSmokeCheck[];
};

export type DeployedSmokeArtifact = {
  generatedAt: string;
  authenticated: boolean;
  publicBaseUrl: string;
  mcpUrl: string;
  ok: boolean;
  checks: DeployedSmokeCheck[];
};

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export type DeployedSmokeInput = {
  baseUrl: string;
  accessToken?: string;
  smokeToolCall?: string;
  fetchImpl?: FetchLike;
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
  ensureParentDirectory?: (outputPath: string) => Promise<void>;
  writeFile: (path: string, content: string) => Promise<void>;
}): Promise<void> {
  const artifact = buildDeployedSmokeArtifact({
    result: input.result,
    generatedAt: input.generatedAt,
    authenticated: input.authenticated
  });
  await input.ensureParentDirectory?.(input.outputPath);
  await input.writeFile(input.outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
}

export async function runDeployedSmokeChecks(input: DeployedSmokeInput): Promise<DeployedSmokeResult> {
  const publicBaseUrl = normalizePublicBaseUrl(input.baseUrl);
  const mcpUrl = `${publicBaseUrl}/mcp`;
  const fetchImpl = input.fetchImpl ?? defaultFetch;
  const checks: DeployedSmokeCheck[] = [];

  checks.push(await checkReadyz({ publicBaseUrl, fetchImpl }));
  checks.push(await checkProtectedResource({ publicBaseUrl, mcpUrl, fetchImpl }));
  checks.push(await checkAuthorizationServer({ publicBaseUrl, fetchImpl }));
  checks.push(await checkServerCard({ publicBaseUrl, fetchImpl }));
  checks.push(await checkCredentialDeleteChallenge({ publicBaseUrl, fetchImpl }));

  if (input.accessToken) {
    const initialize = await checkMcpInitialize({ mcpUrl, accessToken: input.accessToken, fetchImpl });
    checks.push(initialize.check);
    if (initialize.protocolVersion) {
      checks.push(
        await checkMcpInitializedNotification({
          mcpUrl,
          accessToken: input.accessToken,
          protocolVersion: initialize.protocolVersion,
          fetchImpl
        })
      );
      checks.push(
        await checkMcpToolsList({
          mcpUrl,
          accessToken: input.accessToken,
          protocolVersion: initialize.protocolVersion,
          fetchImpl
        })
      );
      const toolCallCheck = await checkMcpToolCall({
        mcpUrl,
        accessToken: input.accessToken,
        protocolVersion: initialize.protocolVersion,
        smokeToolCall: input.smokeToolCall,
        fetchImpl
      });
      if (toolCallCheck) {
        checks.push(toolCallCheck);
      }
    } else {
      checks.push(skip("mcp-initialized-notification", "Authenticated initialize must pass before sending initialized."));
      checks.push(skip("mcp-tools-list-authenticated", "Authenticated initialize must pass before tools/list."));
      checks.push(skip("mcp-tool-call-authenticated", "Authenticated initialize must pass before tools/call."));
    }
  } else {
    checks.push(await checkUnauthenticatedMcpChallenge({ publicBaseUrl, mcpUrl, fetchImpl }));
    checks.push(skip("mcp-initialize-authenticated", "Set MCP_ACCESS_TOKEN to validate authenticated initialize."));
    checks.push(skip("mcp-tools-list-authenticated", "Set MCP_ACCESS_TOKEN to validate authenticated tools/list."));
    checks.push(skip("mcp-tool-call-authenticated", "Set MCP_ACCESS_TOKEN to validate authenticated tools/call."));
  }

  return {
    ok: checks.every((check) => check.status === "pass"),
    publicBaseUrl,
    mcpUrl,
    checks
  };
}

function normalizePublicBaseUrl(value: string): string {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/mcp")) {
    url.pathname = path.slice(0, -"/mcp".length) || "/";
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeGeneratedAt(value: string | Date | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ?? new Date().toISOString();
}

async function checkReadyz(input: { publicBaseUrl: string; fetchImpl: FetchLike }): Promise<DeployedSmokeCheck> {
  const response = await getJson(input.fetchImpl, `${input.publicBaseUrl}/readyz`);
  if (response.status !== 200 || !isRecord(response.body) || response.body.ok !== true) {
    return fail("readyz", "Expected GET /readyz to return HTTP 200 with { ok: true }.");
  }
  return pass("readyz", "GET /readyz returned healthy.");
}

async function checkProtectedResource(input: {
  publicBaseUrl: string;
  mcpUrl: string;
  fetchImpl: FetchLike;
}): Promise<DeployedSmokeCheck> {
  const response = await getJson(input.fetchImpl, `${input.publicBaseUrl}/.well-known/oauth-protected-resource`);
  if (response.status !== 200 || !isRecord(response.body)) {
    return fail("oauth-protected-resource", "Expected protected resource metadata to return HTTP 200 JSON.");
  }
  if (response.body.resource !== input.mcpUrl) {
    return fail("oauth-protected-resource", `Expected resource to equal ${input.mcpUrl}.`);
  }
  if (!Array.isArray(response.body.authorization_servers) || !response.body.authorization_servers.includes(input.publicBaseUrl)) {
    return fail("oauth-protected-resource", `Expected authorization_servers to include ${input.publicBaseUrl}.`);
  }
  return pass("oauth-protected-resource", "Protected resource metadata matches deployed MCP URL.");
}

async function checkAuthorizationServer(input: {
  publicBaseUrl: string;
  fetchImpl: FetchLike;
}): Promise<DeployedSmokeCheck> {
  const response = await getJson(input.fetchImpl, `${input.publicBaseUrl}/.well-known/oauth-authorization-server`);
  if (response.status !== 200 || !isRecord(response.body)) {
    return fail("oauth-authorization-server", "Expected authorization server metadata to return HTTP 200 JSON.");
  }
  if (response.body.issuer !== input.publicBaseUrl) {
    return fail("oauth-authorization-server", `Expected issuer to equal ${input.publicBaseUrl}.`);
  }
  if (response.body.authorization_endpoint !== `${input.publicBaseUrl}/oauth/authorize`) {
    return fail("oauth-authorization-server", "Expected authorization_endpoint to match deployed /oauth/authorize URL.");
  }
  if (response.body.token_endpoint !== `${input.publicBaseUrl}/oauth/token`) {
    return fail("oauth-authorization-server", "Expected token_endpoint to match deployed /oauth/token URL.");
  }
  if (!arrayIncludes(response.body.response_types_supported, "code")) {
    return fail("oauth-authorization-server", "Expected authorization code response type support.");
  }
  if (!arrayIncludes(response.body.grant_types_supported, "authorization_code")) {
    return fail("oauth-authorization-server", "Expected authorization_code grant support.");
  }
  if (!arrayIncludes(response.body.code_challenge_methods_supported, "S256")) {
    return fail("oauth-authorization-server", "Expected PKCE S256 support.");
  }
  if (!arrayIncludes(response.body.token_endpoint_auth_methods_supported, "none")) {
    return fail("oauth-authorization-server", "Expected public-client token exchange support.");
  }
  return pass("oauth-authorization-server", "Authorization server metadata is compatible with public PKCE flow.");
}

async function checkServerCard(input: { publicBaseUrl: string; fetchImpl: FetchLike }): Promise<DeployedSmokeCheck> {
  const response = await getJson(input.fetchImpl, `${input.publicBaseUrl}/.well-known/mcp/server-card.json`);
  if (response.status !== 200 || !isRecord(response.body)) {
    return fail("mcp-server-card", "Expected MCP server card to return HTTP 200 JSON.");
  }
  const authentication = isRecord(response.body.authentication) ? response.body.authentication : undefined;
  if (authentication?.type !== "oauth2") {
    return fail("mcp-server-card", "Expected MCP server card authentication.type to be oauth2.");
  }
  if (!Array.isArray(response.body.tools) || response.body.tools.length === 0) {
    return fail("mcp-server-card", "Expected MCP server card to list at least one tool.");
  }
  return pass("mcp-server-card", "MCP server card advertises OAuth and tools.");
}

async function checkUnauthenticatedMcpChallenge(input: {
  publicBaseUrl: string;
  mcpUrl: string;
  fetchImpl: FetchLike;
}): Promise<DeployedSmokeCheck> {
  const response = await postJson(input.fetchImpl, input.mcpUrl, { jsonrpc: "2.0", id: 1, method: "initialize" });
  const challenge = response.headers.get("www-authenticate") ?? "";
  if (response.status !== 401 || !challenge.includes(`${input.publicBaseUrl}/.well-known/oauth-protected-resource`)) {
    return fail("mcp-unauthenticated-challenge", "Expected unauthenticated /mcp POST to return OAuth WWW-Authenticate challenge.");
  }
  return pass("mcp-unauthenticated-challenge", "Unauthenticated MCP requests receive OAuth challenge.");
}

async function checkCredentialDeleteChallenge(input: {
  publicBaseUrl: string;
  fetchImpl: FetchLike;
}): Promise<DeployedSmokeCheck> {
  const response = await input.fetchImpl(`${input.publicBaseUrl}/api/credential`, { method: "DELETE" });
  const challenge = response.headers.get("www-authenticate") ?? "";
  if (response.status !== 401 || !challenge.includes(`${input.publicBaseUrl}/.well-known/oauth-protected-resource`)) {
    return fail(
      "credential-delete-unauthenticated-challenge",
      "Expected unauthenticated credential deletion to return OAuth WWW-Authenticate challenge."
    );
  }
  return pass("credential-delete-unauthenticated-challenge", "Credential deletion route is protected by OAuth challenge.");
}

async function checkMcpInitialize(input: {
  mcpUrl: string;
  accessToken: string;
  fetchImpl: FetchLike;
}): Promise<{ check: DeployedSmokeCheck; protocolVersion?: string }> {
  const response = await postJson(
    input.fetchImpl,
    input.mcpUrl,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "clockify-mcp-smoke",
          version: "0.1.0"
        }
      }
    },
    input.accessToken
  );
  if (response.status !== 200 || !isRecord(response.body) || !isRecord(response.body.result)) {
    return {
      check: fail("mcp-initialize-authenticated", "Expected authenticated initialize to return JSON-RPC result.")
    };
  }
  if (typeof response.body.result.protocolVersion !== "string") {
    return {
      check: fail("mcp-initialize-authenticated", "Expected initialize result to include protocolVersion.")
    };
  }
  return {
    check: pass("mcp-initialize-authenticated", "Authenticated initialize returned MCP protocol metadata."),
    protocolVersion: response.body.result.protocolVersion
  };
}

async function checkMcpInitializedNotification(input: {
  mcpUrl: string;
  accessToken: string;
  protocolVersion: string;
  fetchImpl: FetchLike;
}): Promise<DeployedSmokeCheck> {
  const response = await postJson(
    input.fetchImpl,
    input.mcpUrl,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    input.accessToken,
    input.protocolVersion
  );
  if (![200, 202].includes(response.status)) {
    return fail("mcp-initialized-notification", "Expected initialized notification to be accepted.");
  }
  return pass("mcp-initialized-notification", "Initialized notification was accepted.");
}

async function checkMcpToolsList(input: {
  mcpUrl: string;
  accessToken: string;
  protocolVersion: string;
  fetchImpl: FetchLike;
}): Promise<DeployedSmokeCheck> {
  const response = await postJson(
    input.fetchImpl,
    input.mcpUrl,
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    input.accessToken,
    input.protocolVersion
  );
  if (response.status !== 200 || !isRecord(response.body) || !isRecord(response.body.result)) {
    return fail("mcp-tools-list-authenticated", "Expected authenticated tools/list to return JSON-RPC result.");
  }
  if (!Array.isArray(response.body.result.tools) || response.body.result.tools.length === 0) {
    return fail("mcp-tools-list-authenticated", "Expected tools/list result to include at least one tool.");
  }
  return pass("mcp-tools-list-authenticated", "Authenticated tools/list returned tool descriptors.");
}

async function checkMcpToolCall(input: {
  mcpUrl: string;
  accessToken: string;
  protocolVersion: string;
  smokeToolCall?: string;
  fetchImpl: FetchLike;
}): Promise<DeployedSmokeCheck | undefined> {
  const toolName = input.smokeToolCall?.trim() || "get_clockify_profile";
  if (toolName === "none") {
    return {
      id: "mcp-tool-call-authenticated",
      status: "skip",
      message: "Authenticated tools/call smoke was disabled; do not use this run as marketplace release evidence."
    };
  }
  if (toolName !== "get_clockify_profile") {
    return fail(
      "mcp-tool-call-authenticated",
      "Unsupported SMOKE_TOOL_CALL value. Allowed values: get_clockify_profile or none."
    );
  }

  const response = await postJson(
    input.fetchImpl,
    input.mcpUrl,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: {}
      }
    },
    input.accessToken,
    input.protocolVersion
  );
  if (response.status !== 200 || !isRecord(response.body) || !("result" in response.body)) {
    return fail("mcp-tool-call-authenticated", "Expected authenticated tools/call to return JSON-RPC result.");
  }
  if (isRecord(response.body.result) && response.body.result.isError === true) {
    return fail("mcp-tool-call-authenticated", "Authenticated tools/call returned an MCP error result.");
  }
  if (containsSecretLikeValue(response.body.result)) {
    return fail("mcp-tool-call-authenticated", "Authenticated tools/call returned a secret-like payload.");
  }
  return pass("mcp-tool-call-authenticated", `Authenticated tools/call returned a safe result for ${toolName}.`);
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<{ status: number; headers: HeadersLike; body: unknown }> {
  const response = await fetchImpl(url);
  return { status: response.status, headers: response.headers, body: await readJson(response) };
}

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  body: Record<string, unknown>,
  accessToken?: string,
  protocolVersion?: string
): Promise<{ status: number; headers: HeadersLike; body: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }
  if (protocolVersion) {
    headers["MCP-Protocol-Version"] = protocolVersion;
  }
  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  return { status: response.status, headers: response.headers, body: await readJson(response) };
}

async function readJson(response: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function pass(id: string, message: string): DeployedSmokeCheck {
  return { id, status: "pass", message };
}

function fail(id: string, message: string): DeployedSmokeCheck {
  return { id, status: "fail", message };
}

function skip(id: string, message: string): DeployedSmokeCheck {
  return { id, status: "skip", message };
}

function arrayIncludes(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.includes(expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function containsSecretLikeValue(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return (
    /(authorization\s*:|bearer\s+|x-api-key|api[_-]?key|refresh[_-]?token|access[_-]?token)/i.test(serialized) ||
    /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/.test(serialized)
  );
}

type HeadersLike = {
  get(name: string): string | null;
};

const defaultFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, init);
  return {
    status: response.status,
    headers: response.headers,
    async json() {
      return await response.json();
    }
  };
};
