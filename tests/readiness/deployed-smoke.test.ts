import {
  buildDeployedSmokeArtifact,
  formatDeployedSmokeText,
  runDeployedSmokeChecks,
  writeDeployedSmokeArtifact
} from "../../src/readiness/deployed-smoke.js";

type FakeResponse = {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): FakeResponse {
  const normalizedHeaders = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    headers: {
      get(name: string) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      }
    },
    async json() {
      return body;
    }
  };
}

function createFetchStub(routes: Record<string, FakeResponse>) {
  const calls: Array<{
    url: string;
    method: string;
    authorization?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { method?: string }) : undefined;
    calls.push({ url, method, authorization: init?.headers?.authorization, headers: init?.headers, body });
    const rpcMethod = body?.method ?? "";
    const response = routes[`${method} ${url} ${rpcMethod}`] ?? routes[`${method} ${url}`];
    if (!response) {
      return jsonResponse(404, { error: "not found" });
    }
    return response;
  });
  return { fetchImpl, calls };
}

describe("deployed smoke checks", () => {
  test("checks public metadata, readiness, and unauthenticated MCP challenge without an access token", async () => {
    const baseUrl = "https://clockify-mcp.softpeak.dev";
    const { fetchImpl, calls } = createFetchStub({
      [`GET ${baseUrl}/readyz`]: jsonResponse(200, { ok: true }),
      [`GET ${baseUrl}/.well-known/oauth-protected-resource`]: jsonResponse(200, {
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"]
      }),
      [`GET ${baseUrl}/.well-known/oauth-authorization-server`]: jsonResponse(200, {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"]
      }),
      [`GET ${baseUrl}/.well-known/mcp/server-card.json`]: jsonResponse(200, {
        serverInfo: { name: "clockify-mcp" },
        authentication: { type: "oauth2" },
        tools: [{ name: "get_clockify_profile" }]
      }),
      [`POST ${baseUrl}/mcp`]: jsonResponse(
        401,
        { error: "unauthorized" },
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }
      ),
      [`DELETE ${baseUrl}/api/credential`]: jsonResponse(
        401,
        { error: "unauthorized" },
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }
      )
    });

    const result = await runDeployedSmokeChecks({ baseUrl: `${baseUrl}/mcp`, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.checks.filter((check) => check.status === "pass").map((check) => check.id)).toEqual([
      "readyz",
      "oauth-protected-resource",
      "oauth-authorization-server",
      "mcp-server-card",
      "credential-delete-unauthenticated-challenge",
      "mcp-unauthenticated-challenge"
    ]);
    expect(result.checks.filter((check) => check.status === "skip").map((check) => check.id)).toEqual([
      "mcp-initialize-authenticated",
      "mcp-tools-list-authenticated",
      "mcp-tool-call-authenticated"
    ]);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toContain(`POST ${baseUrl}/mcp`);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toContain(`DELETE ${baseUrl}/api/credential`);
  });

  test("runs authenticated MCP initialize and tools/list checks when an access token is provided", async () => {
    const baseUrl = "https://clockify-mcp.softpeak.dev";
    const { fetchImpl, calls } = createFetchStub({
      [`GET ${baseUrl}/readyz`]: jsonResponse(200, { ok: true }),
      [`GET ${baseUrl}/.well-known/oauth-protected-resource`]: jsonResponse(200, {
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"]
      }),
      [`GET ${baseUrl}/.well-known/oauth-authorization-server`]: jsonResponse(200, {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"]
      }),
      [`GET ${baseUrl}/.well-known/mcp/server-card.json`]: jsonResponse(200, {
        serverInfo: { name: "clockify-mcp" },
        authentication: { type: "oauth2" },
        tools: [{ name: "get_clockify_profile" }]
      }),
      [`POST ${baseUrl}/mcp initialize`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2025-06-18"
        }
      }),
      [`POST ${baseUrl}/mcp notifications/initialized`]: jsonResponse(202, undefined),
      [`POST ${baseUrl}/mcp tools/list`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 2,
        result: {
          tools: [{ name: "get_clockify_profile" }]
        }
      }),
      [`POST ${baseUrl}/mcp tools/call`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 3,
        result: {
          structuredContent: {
            user: { id: "u1", name: "Ada", email: "ada@example.com" },
            workspaces: [{ id: "w1", name: "Personal" }]
          }
        }
      }),
      [`DELETE ${baseUrl}/api/credential`]: jsonResponse(
        401,
        { error: "unauthorized" },
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }
      )
    });

    const result = await runDeployedSmokeChecks({ baseUrl, accessToken: "access-token", fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    expect(calls.filter((call) => call.method === "POST").every((call) => call.authorization === "Bearer access-token")).toBe(
      true
    );
    expect(calls.find((call) => call.body && (call.body as { method?: string }).method === "initialize")?.body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "clockify-mcp-smoke", version: "0.1.0" }
      }
    });
    expect(calls.map((call) => (call.body as { method?: string } | undefined)?.method).filter(Boolean)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call"
    ]);
    expect(calls.find((call) => (call.body as { method?: string } | undefined)?.method === "tools/list")?.headers).toMatchObject({
      "MCP-Protocol-Version": "2025-06-18"
    });
    expect(calls.find((call) => (call.body as { method?: string } | undefined)?.method === "tools/call")?.body).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_clockify_profile", arguments: {} }
    });
    expect(calls.find((call) => call.method === "DELETE")?.authorization).toBeUndefined();
  });

  test("records disabled authenticated tools/call as non-release-safe smoke evidence", async () => {
    const baseUrl = "https://clockify-mcp.softpeak.dev";
    const { fetchImpl, calls } = createFetchStub({
      [`GET ${baseUrl}/readyz`]: jsonResponse(200, { ok: true }),
      [`GET ${baseUrl}/.well-known/oauth-protected-resource`]: jsonResponse(200, {
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"]
      }),
      [`GET ${baseUrl}/.well-known/oauth-authorization-server`]: jsonResponse(200, {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"]
      }),
      [`GET ${baseUrl}/.well-known/mcp/server-card.json`]: jsonResponse(200, {
        serverInfo: { name: "clockify-mcp" },
        authentication: { type: "oauth2" },
        tools: [{ name: "get_clockify_profile" }]
      }),
      [`POST ${baseUrl}/mcp initialize`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-06-18" }
      }),
      [`POST ${baseUrl}/mcp notifications/initialized`]: jsonResponse(202, undefined),
      [`POST ${baseUrl}/mcp tools/list`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [{ name: "get_clockify_profile" }] }
      }),
      [`DELETE ${baseUrl}/api/credential`]: jsonResponse(
        401,
        { error: "unauthorized" },
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }
      )
    });

    const result = await runDeployedSmokeChecks({ baseUrl, accessToken: "access-token", smokeToolCall: "none", fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      id: "mcp-tool-call-authenticated",
      status: "skip",
      message: "Authenticated tools/call smoke was disabled; do not use this run as marketplace release evidence."
    });
    expect(calls.map((call) => (call.body as { method?: string } | undefined)?.method).filter(Boolean)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list"
    ]);
  });

  test("rejects unsupported smoke tool call names without invoking arbitrary tools", async () => {
    const baseUrl = "https://clockify-mcp.softpeak.dev";
    const { fetchImpl, calls } = createFetchStub({
      [`GET ${baseUrl}/readyz`]: jsonResponse(200, { ok: true }),
      [`GET ${baseUrl}/.well-known/oauth-protected-resource`]: jsonResponse(200, {
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"]
      }),
      [`GET ${baseUrl}/.well-known/oauth-authorization-server`]: jsonResponse(200, {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"]
      }),
      [`GET ${baseUrl}/.well-known/mcp/server-card.json`]: jsonResponse(200, {
        serverInfo: { name: "clockify-mcp" },
        authentication: { type: "oauth2" },
        tools: [{ name: "get_clockify_profile" }]
      }),
      [`POST ${baseUrl}/mcp initialize`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-06-18" }
      }),
      [`POST ${baseUrl}/mcp notifications/initialized`]: jsonResponse(202, undefined),
      [`POST ${baseUrl}/mcp tools/list`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [{ name: "get_clockify_profile" }] }
      }),
      [`DELETE ${baseUrl}/api/credential`]: jsonResponse(
        401,
        { error: "unauthorized" },
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }
      )
    });

    const result = await runDeployedSmokeChecks({
      baseUrl,
      accessToken: "access-token",
      smokeToolCall: "delete_time_entry",
      fetchImpl
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      id: "mcp-tool-call-authenticated",
      status: "fail",
      message: "Unsupported SMOKE_TOOL_CALL value. Allowed values: get_clockify_profile or none."
    });
    expect(calls.map((call) => (call.body as { method?: string } | undefined)?.method).filter(Boolean)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list"
    ]);
  });

  test("fails authenticated tools/call without leaking a secret-like tool result", async () => {
    const baseUrl = "https://clockify-mcp.softpeak.dev";
    const { fetchImpl } = createFetchStub({
      [`GET ${baseUrl}/readyz`]: jsonResponse(200, { ok: true }),
      [`GET ${baseUrl}/.well-known/oauth-protected-resource`]: jsonResponse(200, {
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"]
      }),
      [`GET ${baseUrl}/.well-known/oauth-authorization-server`]: jsonResponse(200, {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"]
      }),
      [`GET ${baseUrl}/.well-known/mcp/server-card.json`]: jsonResponse(200, {
        serverInfo: { name: "clockify-mcp" },
        authentication: { type: "oauth2" },
        tools: [{ name: "get_clockify_profile" }]
      }),
      [`POST ${baseUrl}/mcp initialize`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-06-18" }
      }),
      [`POST ${baseUrl}/mcp notifications/initialized`]: jsonResponse(202, undefined),
      [`POST ${baseUrl}/mcp tools/list`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [{ name: "get_clockify_profile" }] }
      }),
      [`POST ${baseUrl}/mcp tools/call`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 3,
        result: {
          structuredContent: { access_token: "secret-tool-result-token" }
        }
      }),
      [`DELETE ${baseUrl}/api/credential`]: jsonResponse(
        401,
        { error: "unauthorized" },
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }
      )
    });

    const result = await runDeployedSmokeChecks({ baseUrl, accessToken: "access-token", fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      id: "mcp-tool-call-authenticated",
      status: "fail",
      message: "Authenticated tools/call returned a secret-like payload."
    });
    expect(JSON.stringify(result)).not.toContain("secret-tool-result-token");
  });

  test("fails authenticated tools/call when MCP returns an auth-error result", async () => {
    const baseUrl = "https://clockify-mcp.softpeak.dev";
    const { fetchImpl } = createFetchStub({
      [`GET ${baseUrl}/readyz`]: jsonResponse(200, { ok: true }),
      [`GET ${baseUrl}/.well-known/oauth-protected-resource`]: jsonResponse(200, {
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"]
      }),
      [`GET ${baseUrl}/.well-known/oauth-authorization-server`]: jsonResponse(200, {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"]
      }),
      [`GET ${baseUrl}/.well-known/mcp/server-card.json`]: jsonResponse(200, {
        serverInfo: { name: "clockify-mcp" },
        authentication: { type: "oauth2" },
        tools: [{ name: "get_clockify_profile" }]
      }),
      [`POST ${baseUrl}/mcp initialize`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-06-18" }
      }),
      [`POST ${baseUrl}/mcp notifications/initialized`]: jsonResponse(202, undefined),
      [`POST ${baseUrl}/mcp tools/list`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [{ name: "get_clockify_profile" }] }
      }),
      [`POST ${baseUrl}/mcp tools/call`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 3,
        result: {
          isError: true,
          _meta: { "mcp/www_authenticate": [`Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`] }
        }
      }),
      [`DELETE ${baseUrl}/api/credential`]: jsonResponse(
        401,
        { error: "unauthorized" },
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }
      )
    });

    const result = await runDeployedSmokeChecks({ baseUrl, accessToken: "access-token", fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      id: "mcp-tool-call-authenticated",
      status: "fail",
      message: "Authenticated tools/call returned an MCP error result."
    });
  });

  test("builds a stable JSON evidence artifact without recording bearer tokens", async () => {
    const baseUrl = "https://clockify-mcp.softpeak.dev";
    const { fetchImpl } = createFetchStub({
      [`GET ${baseUrl}/readyz`]: jsonResponse(200, { ok: true }),
      [`GET ${baseUrl}/.well-known/oauth-protected-resource`]: jsonResponse(200, {
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"]
      }),
      [`GET ${baseUrl}/.well-known/oauth-authorization-server`]: jsonResponse(200, {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"]
      }),
      [`GET ${baseUrl}/.well-known/mcp/server-card.json`]: jsonResponse(200, {
        serverInfo: { name: "clockify-mcp" },
        authentication: { type: "oauth2" },
        tools: [{ name: "get_clockify_profile" }]
      }),
      [`POST ${baseUrl}/mcp initialize`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-06-18" }
      }),
      [`POST ${baseUrl}/mcp notifications/initialized`]: jsonResponse(202, undefined),
      [`POST ${baseUrl}/mcp tools/list`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [{ name: "get_clockify_profile" }] }
      }),
      [`POST ${baseUrl}/mcp tools/call`]: jsonResponse(200, {
        jsonrpc: "2.0",
        id: 3,
        result: {
          structuredContent: {
            user: { id: "u1", name: "Ada", email: "ada@example.com" },
            workspaces: [{ id: "w1", name: "Personal" }]
          }
        }
      }),
      [`DELETE ${baseUrl}/api/credential`]: jsonResponse(
        401,
        { error: "unauthorized" },
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }
      )
    });

    const result = await runDeployedSmokeChecks({ baseUrl, accessToken: "secret-token", fetchImpl });
    const artifact = buildDeployedSmokeArtifact({
      result,
      generatedAt: "2026-07-03T12:00:00.000Z",
      authenticated: true
    });

    expect(artifact).toMatchObject({
      generatedAt: "2026-07-03T12:00:00.000Z",
      authenticated: true,
      publicBaseUrl: baseUrl,
      mcpUrl: `${baseUrl}/mcp`,
      ok: true
    });
    expect(artifact.checks.length).toBeGreaterThan(0);
    expect(JSON.stringify(artifact)).not.toContain("secret-token");
  });

  test("writes a JSON evidence artifact through an injected writer", async () => {
    const result = {
      ok: true,
      publicBaseUrl: "https://clockify-mcp.softpeak.dev",
      mcpUrl: "https://clockify-mcp.softpeak.dev/mcp",
      checks: [{ id: "readyz", status: "pass" as const, message: "GET /readyz returned healthy." }]
    };
    const writes: Array<{ path: string; content: string }> = [];

    await writeDeployedSmokeArtifact({
      result,
      outputPath: "artifacts/deployed-smoke.json",
      generatedAt: "2026-07-03T12:00:00.000Z",
      authenticated: true,
      writeFile: async (path, content) => {
        writes.push({ path, content });
      }
    });

    expect(writes[0]?.path).toBe("artifacts/deployed-smoke.json");
    expect(writes[0]?.content.endsWith("\n")).toBe(true);
    expect(JSON.parse(writes[0]?.content ?? "{}")).toMatchObject({
      generatedAt: "2026-07-03T12:00:00.000Z",
      authenticated: true,
      ok: true
    });
  });

  test("ensures the artifact parent directory before writing", async () => {
    const result = {
      ok: true,
      publicBaseUrl: "https://clockify-mcp.softpeak.dev",
      mcpUrl: "https://clockify-mcp.softpeak.dev/mcp",
      checks: [{ id: "readyz", status: "pass" as const, message: "GET /readyz returned healthy." }]
    };
    const ensuredPaths: string[] = [];

    await writeDeployedSmokeArtifact({
      result,
      outputPath: "artifacts/nested/deployed-smoke.json",
      generatedAt: "2026-07-03T12:00:00.000Z",
      authenticated: true,
      ensureParentDirectory: async (path) => {
        ensuredPaths.push(path);
      },
      writeFile: async () => {}
    });

    expect(ensuredPaths).toEqual(["artifacts/nested/deployed-smoke.json"]);
  });

  test("formats deployed smoke checks for CLI output", () => {
    const lines = formatDeployedSmokeText({
      ok: false,
      publicBaseUrl: "https://clockify-mcp.softpeak.dev",
      mcpUrl: "https://clockify-mcp.softpeak.dev/mcp",
      checks: [
        { id: "readyz", status: "pass", message: "GET /readyz returned healthy." },
        { id: "mcp-tools-list-authenticated", status: "skip", message: "Set MCP_ACCESS_TOKEN." }
      ]
    });

    expect(lines).toEqual([
      "Public base URL: https://clockify-mcp.softpeak.dev",
      "MCP URL: https://clockify-mcp.softpeak.dev/mcp",
      "[PASS] readyz: GET /readyz returned healthy.",
      "[SKIP] mcp-tools-list-authenticated: Set MCP_ACCESS_TOKEN."
    ]);
  });

  test("fails when protected resource metadata points at a different MCP URL", async () => {
    const baseUrl = "https://clockify-mcp.softpeak.dev";
    const { fetchImpl } = createFetchStub({
      [`GET ${baseUrl}/readyz`]: jsonResponse(200, { ok: true }),
      [`GET ${baseUrl}/.well-known/oauth-protected-resource`]: jsonResponse(200, {
        resource: "https://other.example/mcp",
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"]
      }),
      [`GET ${baseUrl}/.well-known/oauth-authorization-server`]: jsonResponse(200, {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"]
      }),
      [`GET ${baseUrl}/.well-known/mcp/server-card.json`]: jsonResponse(200, {
        serverInfo: { name: "clockify-mcp" },
        authentication: { type: "oauth2" },
        tools: [{ name: "get_clockify_profile" }]
      }),
      [`POST ${baseUrl}/mcp`]: jsonResponse(
        401,
        { error: "unauthorized" },
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }
      ),
      [`DELETE ${baseUrl}/api/credential`]: jsonResponse(
        401,
        { error: "unauthorized" },
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }
      )
    });

    const result = await runDeployedSmokeChecks({ baseUrl, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      id: "oauth-protected-resource",
      status: "fail",
      message: `Expected resource to equal ${baseUrl}/mcp.`
    });
  });

  test("fails when credential delete route does not return an OAuth challenge", async () => {
    const baseUrl = "https://clockify-mcp.softpeak.dev";
    const { fetchImpl } = createFetchStub({
      [`GET ${baseUrl}/readyz`]: jsonResponse(200, { ok: true }),
      [`GET ${baseUrl}/.well-known/oauth-protected-resource`]: jsonResponse(200, {
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"]
      }),
      [`GET ${baseUrl}/.well-known/oauth-authorization-server`]: jsonResponse(200, {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"]
      }),
      [`GET ${baseUrl}/.well-known/mcp/server-card.json`]: jsonResponse(200, {
        serverInfo: { name: "clockify-mcp" },
        authentication: { type: "oauth2" },
        tools: [{ name: "get_clockify_profile" }]
      }),
      [`POST ${baseUrl}/mcp`]: jsonResponse(
        401,
        { error: "unauthorized" },
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }
      ),
      [`DELETE ${baseUrl}/api/credential`]: jsonResponse(404, { error: "not found" })
    });

    const result = await runDeployedSmokeChecks({ baseUrl, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      id: "credential-delete-unauthenticated-challenge",
      status: "fail",
      message: "Expected unauthenticated credential deletion to return OAuth WWW-Authenticate challenge."
    });
  });

  test("fails when authorization server metadata is missing account-linking fields", async () => {
    const baseUrl = "https://clockify-mcp.softpeak.dev";
    const { fetchImpl } = createFetchStub({
      [`GET ${baseUrl}/readyz`]: jsonResponse(200, { ok: true }),
      [`GET ${baseUrl}/.well-known/oauth-protected-resource`]: jsonResponse(200, {
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"]
      }),
      [`GET ${baseUrl}/.well-known/oauth-authorization-server`]: jsonResponse(200, {
        issuer: baseUrl,
        token_endpoint: `${baseUrl}/oauth/token`,
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"]
      }),
      [`GET ${baseUrl}/.well-known/mcp/server-card.json`]: jsonResponse(200, {
        serverInfo: { name: "clockify-mcp" },
        authentication: { type: "oauth2" },
        tools: [{ name: "get_clockify_profile" }]
      }),
      [`POST ${baseUrl}/mcp`]: jsonResponse(
        401,
        { error: "unauthorized" },
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }
      ),
      [`DELETE ${baseUrl}/api/credential`]: jsonResponse(
        401,
        { error: "unauthorized" },
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }
      )
    });

    const result = await runDeployedSmokeChecks({ baseUrl, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      id: "oauth-authorization-server",
      status: "fail",
      message: "Expected authorization_endpoint to match deployed /oauth/authorize URL."
    });
  });
});
