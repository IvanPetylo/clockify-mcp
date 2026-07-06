import { buildApp } from "../../src/server/app.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { AuthorizationError } from "../../src/auth/authorization.js";
import { issueAccessToken, type TokenRevocationStore } from "../../src/auth/jwt.js";
import { createOAuthService } from "../../src/auth/oauth.js";
import { createCredentialCipher } from "../../src/auth/crypto.js";
import { InMemoryCredentialStore } from "../../src/db/credential-store.js";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
  version: string;
};
const serverManifest = JSON.parse(readFileSync(new URL("../../server.json", import.meta.url), "utf8")) as {
  title: string;
  description: string;
};
const testCodeVerifier = "a".repeat(43);
const testCodeChallenge = createHash("sha256").update(testCodeVerifier).digest("base64url");

class InMemoryTokenRevocationStore implements TokenRevocationStore {
  readonly revocations = new Map<string, { ownerId: string; clientId?: string; expiresAt?: Date }>();

  isRevoked(tokenId: string): boolean {
    return this.revocations.has(tokenId);
  }

  revoke(input: { tokenId: string; ownerId: string; clientId?: string; expiresAt?: Date }): void {
    this.revocations.set(input.tokenId, {
      ownerId: input.ownerId,
      clientId: input.clientId,
      expiresAt: input.expiresAt
    });
  }
}

function expectNoStore(response: { headers: Record<string, unknown> }): void {
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers.pragma).toBe("no-cache");
}

function testOAuthService() {
  return createOAuthService({
    issuer: "https://clockify-mcp.example.com",
    resource: "https://clockify-mcp.example.com/mcp",
    jwtSecret: "test-secret-with-at-least-32-bytes!",
    allowedRedirectUris: ["https://chat.openai.com/aip/callback"],
    allowedScopes: ["clockify.read", "clockify.time.write", "clockify.time.delete"]
  });
}

describe("HTTP app", () => {
  test("GET /healthz returns ok", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  test("GET /readyz returns ok when dependencies are healthy", async () => {
    const app = buildApp({ healthCheck: vi.fn(async () => undefined) });
    const response = await app.inject({ method: "GET", url: "/readyz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  test("GET /readyz returns 503 when dependency health check fails", async () => {
    const app = buildApp({
      healthCheck: vi.fn(async () => {
        throw new Error("database unavailable");
      })
    });
    const response = await app.inject({ method: "GET", url: "/readyz" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false });
  });

  test("sensitive OAuth and onboarding POST routes are rate limited by client", async () => {
    const app = buildApp({
      sensitiveRouteRateLimit: {
        max: 1,
        windowMs: 60_000
      }
    });

    const firstResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: { grant_type: "authorization_code" }
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: { grant_type: "authorization_code" }
    });

    expect(firstResponse.statusCode).not.toBe(429);
    expect(secondResponse.statusCode).toBe(429);
    expect(secondResponse.headers["retry-after"]).toBe("60");
    expect(secondResponse.json()).toEqual({
      error: "rate_limited",
      error_description: "Too many attempts. Retry later."
    });
  });

  test("sensitive route limiter separates forwarded clients when a proxy hop is trusted", async () => {
    const app = buildApp({
      trustProxy: 1,
      sensitiveRouteRateLimit: {
        max: 1,
        windowMs: 60_000
      }
    });

    const firstClientResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "x-forwarded-for": "203.0.113.10" },
      payload: { grant_type: "authorization_code" }
    });
    const secondClientResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "x-forwarded-for": "203.0.113.11" },
      payload: { grant_type: "authorization_code" }
    });
    const repeatedFirstClientResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "x-forwarded-for": "203.0.113.10" },
      payload: { grant_type: "authorization_code" }
    });

    expect(firstClientResponse.statusCode).not.toBe(429);
    expect(secondClientResponse.statusCode).not.toBe(429);
    expect(repeatedFirstClientResponse.statusCode).toBe(429);
  });

  test.each(["/oauth/token", "/oauth/revoke", "/onboarding", "/api/onboarding/credential"])(
    "sensitive route limiter covers POST %s",
    async (url) => {
      const app = buildApp({
        sensitiveRouteRateLimit: {
          max: 1,
          windowMs: 60_000
        }
      });

      const firstResponse = await app.inject({ method: "POST", url, payload: {} });
      const secondResponse = await app.inject({ method: "POST", url, payload: {} });

      expect(firstResponse.statusCode).not.toBe(429);
      expect(secondResponse.statusCode).toBe(429);
    }
  );

  test("rate limited sensitive routes return no-store responses", async () => {
    const app = buildApp({
      sensitiveRouteRateLimit: {
        max: 1,
        windowMs: 60_000
      }
    });

    await app.inject({ method: "POST", url: "/oauth/revoke", payload: {} });
    const response = await app.inject({ method: "POST", url: "/oauth/revoke", payload: {} });

    expect(response.statusCode).toBe(429);
    expectNoStore(response);
  });

  test.each([
    ["OAuth unavailable", undefined, { grant_type: "authorization_code" }, 503, { error: "oauth_unavailable" }],
    ["unsupported grant", testOAuthService(), { grant_type: "client_credentials" }, 400, { error: "unsupported_grant_type" }]
  ])("POST /oauth/token returns no-store for %s", async (_name, oauthService, payload, statusCode, body) => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", oauthService });
    const response = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload
    });

    expect(response.statusCode).toBe(statusCode);
    expectNoStore(response);
    expect(response.json()).toEqual(body);
  });

  test("GET /.well-known/oauth-protected-resource returns resource metadata", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com" });
    const response = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      resource: "https://clockify-mcp.example.com/mcp",
      authorization_servers: ["https://clockify-mcp.example.com"],
      scopes_supported: ["clockify.read", "clockify.time.write", "clockify.time.delete"]
    });
  });

  test("GET /.well-known/oauth-authorization-server advertises public PKCE token exchange", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com" });
    const response = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      issuer: "https://clockify-mcp.example.com",
      authorization_endpoint: "https://clockify-mcp.example.com/oauth/authorize",
      token_endpoint: "https://clockify-mcp.example.com/oauth/token",
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"]
    });
  });

  test("OAuth authorize redirects to onboarding UI and strips user-controlled subject", async () => {
    const jwtSecret = "test-secret-with-at-least-32-bytes!";
    const oauthService = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret,
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"]
    });
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", oauthService });
    const challenge = testCodeChallenge;
    const authorizeResponse = await app.inject({
      method: "GET",
      url:
        "/oauth/authorize?response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fchat.openai.com%2Faip%2Fcallback" +
        `&code_challenge=${challenge}&code_challenge_method=S256&state=s1&resource=https%3A%2F%2Fclockify-mcp.example.com%2Fmcp` +
        "&scope=clockify.read&subject=clockify%3Auser%3Aclockify-user-1"
    });

    expect(authorizeResponse.statusCode).toBe(302);
    expectNoStore(authorizeResponse);
    const location = new URL(authorizeResponse.headers.location as string, "https://clockify-mcp.example.com");
    expect(location.pathname).toBe("/onboarding");
    expect(location.searchParams.get("state")).toBe("s1");
    expect(location.searchParams.get("code")).toBeNull();
    expect(location.searchParams.get("subject")).toBeNull();
  });

  test("OAuth authorize unavailable response is no-store", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com" });
    const response = await app.inject({
      method: "GET",
      url:
        "/oauth/authorize?response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fchat.openai.com%2Faip%2Fcallback" +
        `&code_challenge=${testCodeChallenge}&code_challenge_method=S256&state=s1&resource=https%3A%2F%2Fclockify-mcp.example.com%2Fmcp`
    });

    expect(response.statusCode).toBe(503);
    expectNoStore(response);
    expect(response.json()).toEqual({ error: "oauth_unavailable" });
  });

  test.each(["/mcp", "/oauth/token", "/api/onboarding/credential"])(
    "malformed JSON on sensitive POST %s returns no-store",
    async (url) => {
      const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com" });
      const response = await app.inject({
        method: "POST",
        url,
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-token"
        },
        payload: "{bad json"
      });

      expect(response.statusCode).toBe(400);
      expectNoStore(response);
    }
  );

  test("POST /oauth/token without a body returns a controlled no-store OAuth error", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", oauthService: testOAuthService() });
    const response = await app.inject({
      method: "POST",
      url: "/oauth/token"
    });

    expect(response.statusCode).toBe(400);
    expectNoStore(response);
    expect(response.json()).toEqual({ error: "unsupported_grant_type" });
  });

  test("POST /api/onboarding/credential without a body returns a controlled no-store error", async () => {
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 8).toString("base64") }
    });
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      oauthService: testOAuthService(),
      credentialStore: new InMemoryCredentialStore({ cipher })
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/onboarding/credential"
    });

    expect(response.statusCode).toBe(400);
    expectNoStore(response);
    expect(response.json()).toEqual({
      error: "invalid_oauth_request",
      error_description: "OAuth request validation failed."
    });
  });

  test("POST /onboarding validates Clockify key, stores credential, and redirects to OAuth callback", async () => {
    const jwtSecret = "test-secret-with-at-least-32-bytes!";
    const oauthService = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret,
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"]
    });
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 8).toString("base64") }
    });
    const credentialStore = new InMemoryCredentialStore({ cipher });
    const createClient = vi.fn(() => ({
      getProfile: vi.fn(async () => ({ id: "clockify-user-1", name: "Ada", email: "ada@example.com" }))
    }));
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      oauthService,
      credentialStore,
      createClient
    });
    const verifier = testCodeVerifier;
    const challenge = testCodeChallenge;
    const response = await app.inject({
      method: "POST",
      url: "/onboarding",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        clockifyApiKey: "clockify-secret-api-key",
        response_type: "code",
        client_id: "chatgpt",
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "s2",
        resource: "https://clockify-mcp.example.com/mcp",
        scope: "clockify.read"
      }).toString()
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.pragma).toBe("no-cache");
    const location = new URL(response.headers.location as string);
    expect(location.origin + location.pathname).toBe("https://chat.openai.com/aip/callback");
    expect(location.searchParams.get("state")).toBe("s2");
    const code = location.searchParams.get("code");
    expect(code).toEqual(expect.any(String));
    expect(await credentialStore.decryptActiveByOwnerId({ ownerId: "clockify:user:clockify-user-1" })).toBe(
      "clockify-secret-api-key"
    );

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: {
        grant_type: "authorization_code",
        code,
        client_id: "chatgpt",
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: verifier,
        resource: "https://clockify-mcp.example.com/mcp"
      }
    });

    expect(tokenResponse.statusCode).toBe(200);
    expect(tokenResponse.headers["cache-control"]).toBe("no-store");
    expect(tokenResponse.headers.pragma).toBe("no-cache");
    expect(tokenResponse.json()).toMatchObject({
      token_type: "Bearer",
      scope: "clockify.read"
    });
  });

  test("GET /onboarding renders Clockify API key form with OAuth context", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", oauthService: testOAuthService() });
    const response = await app.inject({
      method: "GET",
      url:
        "/onboarding?response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fchat.openai.com%2Faip%2Fcallback" +
        `&code_challenge=${testCodeChallenge}&code_challenge_method=S256&state=s1&resource=https%3A%2F%2Fclockify-mcp.example.com%2Fmcp` +
        "&scope=clockify.read"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain('name="clockifyApiKey"');
    expect(response.body).toContain('name="state" value="s1"');
    expect(response.body).not.toContain("clockify-secret-api-key");
  });

  test("GET /onboarding sends strict no-store CSP with matching style nonce", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", oauthService: testOAuthService() });
    const response = await app.inject({
      method: "GET",
      url:
        "/onboarding?response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fchat.openai.com%2Faip%2Fcallback" +
        `&code_challenge=${testCodeChallenge}&code_challenge_method=S256&state=s1&resource=https%3A%2F%2Fclockify-mcp.example.com%2Fmcp` +
        "&scope=clockify.read"
    });

    const csp = response.headers["content-security-policy"] as string;
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-inline'");
    const nonce = /style-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toEqual(expect.any(String));
    expect(response.body).toContain(`<style nonce="${nonce}">`);
  });

  test("GET /onboarding does not render Clockify API key form when OAuth is unavailable", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com" });
    const response = await app.inject({
      method: "GET",
      url:
        "/onboarding?response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fchat.openai.com%2Faip%2Fcallback" +
        `&code_challenge=${testCodeChallenge}&code_challenge_method=S256&state=s1&resource=https%3A%2F%2Fclockify-mcp.example.com%2Fmcp` +
        "&scope=clockify.read"
    });

    expect(response.statusCode).toBe(503);
    expectNoStore(response);
    expect(response.body).not.toContain('name="clockifyApiKey"');
  });

  test("POST /onboarding does not store valid Clockify key when OAuth request is invalid", async () => {
    const jwtSecret = "test-secret-with-at-least-32-bytes!";
    const oauthService = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret,
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"]
    });
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 8).toString("base64") }
    });
    const credentialStore = new InMemoryCredentialStore({ cipher });
    const createClient = vi.fn(() => ({
      getProfile: vi.fn(async () => ({ id: "clockify-user-1", name: "Ada", email: "ada@example.com" }))
    }));
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      oauthService,
      credentialStore,
      createClient
    });
    const challenge = testCodeChallenge;
    const response = await app.inject({
      method: "POST",
      url: "/onboarding",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        clockifyApiKey: "clockify-secret-api-key",
        response_type: "code",
        client_id: "chatgpt",
        redirect_uri: "https://evil.example/callback",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "s2",
        resource: "https://clockify-mcp.example.com/mcp",
        scope: "clockify.read"
      }).toString()
    });

    expect(response.statusCode).toBe(400);
    expectNoStore(response);
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(createClient).not.toHaveBeenCalled();
    expect(credentialStore.list({ ownerId: "clockify:user:clockify-user-1" })).toEqual([]);
    expect(response.body).not.toContain("clockify-secret-api-key");
  });

  test("POST /onboarding does not store valid Clockify key when OAuth scope is unsupported", async () => {
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
      getProfile: vi.fn(async () => ({ id: "clockify-user-1", name: "Ada", email: "ada@example.com" }))
    }));
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      oauthService,
      credentialStore,
      createClient
    });
    const challenge = testCodeChallenge;
    const response = await app.inject({
      method: "POST",
      url: "/onboarding",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        clockifyApiKey: "clockify-secret-api-key",
        response_type: "code",
        client_id: "chatgpt",
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "s2",
        resource: "https://clockify-mcp.example.com/mcp",
        scope: "clockify.read clockify.admin"
      }).toString()
    });

    expect(response.statusCode).toBe(400);
    expectNoStore(response);
    expect(createClient).not.toHaveBeenCalled();
    expect(credentialStore.list({ ownerId: "clockify:user:clockify-user-1" })).toEqual([]);
    expect(response.body).not.toContain("clockify-secret-api-key");
  });

  test("GET /oauth/authorize rejects invalid OAuth request before showing onboarding", async () => {
    const oauthService = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"],
      allowedScopes: ["clockify.read", "clockify.time.write", "clockify.time.delete"]
    });
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", oauthService });

    const response = await app.inject({
      method: "GET",
      url:
        "/oauth/authorize?response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fevil.example%2Fcallback" +
        `&code_challenge=${testCodeChallenge}&code_challenge_method=S256&state=s1&resource=https%3A%2F%2Fclockify-mcp.example.com%2Fmcp` +
        "&scope=clockify.read"
    });

    expect(response.statusCode).toBe(400);
    expectNoStore(response);
    expect(response.body).toContain("OAuth request validation failed");
    expect(response.body).not.toContain('name="clockifyApiKey"');
  });

  test.each([
    [
      "invalid resource",
      "response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fchat.openai.com%2Faip%2Fcallback" +
        `&code_challenge=${testCodeChallenge}&code_challenge_method=S256&state=s1&resource=https%3A%2F%2Fother.example.com%2Fmcp` +
        "&scope=clockify.read"
    ],
    [
      "unsupported scope",
      "response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fchat.openai.com%2Faip%2Fcallback" +
        `&code_challenge=${testCodeChallenge}&code_challenge_method=S256&state=s1&resource=https%3A%2F%2Fclockify-mcp.example.com%2Fmcp` +
        "&scope=clockify.read%20clockify.admin"
    ],
    [
      "missing S256 PKCE method",
      "response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fchat.openai.com%2Faip%2Fcallback" +
        `&code_challenge=${testCodeChallenge}&state=s1&resource=https%3A%2F%2Fclockify-mcp.example.com%2Fmcp` +
        "&scope=clockify.read"
    ]
  ])("GET /onboarding rejects %s before rendering Clockify API key form", async (_name, queryString) => {
    const oauthService = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"],
      allowedScopes: ["clockify.read", "clockify.time.write", "clockify.time.delete"]
    });
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", oauthService });

    const response = await app.inject({ method: "GET", url: `/onboarding?${queryString}` });

    expect(response.statusCode).toBe(400);
    expectNoStore(response);
    expect(response.body).toContain("OAuth request validation failed");
    expect(response.body).not.toContain('name="clockifyApiKey"');
  });

  test("POST /api/onboarding/credential rejects invalid OAuth request before validating Clockify key", async () => {
    const oauthService = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"],
      allowedScopes: ["clockify.read", "clockify.time.write", "clockify.time.delete"]
    });
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 8).toString("base64") }
    });
    const credentialStore = new InMemoryCredentialStore({ cipher });
    const createClient = vi.fn(() => ({
      getProfile: vi.fn(async () => ({ id: "clockify-user-1", name: "Ada", email: "ada@example.com" }))
    }));
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      oauthService,
      credentialStore,
      createClient
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/onboarding/credential",
      payload: {
        clockifyApiKey: "clockify-secret-api-key",
        oauth: {
          response_type: "code",
          client_id: "chatgpt",
          redirect_uri: "https://chat.openai.com/aip/callback",
          code_challenge: testCodeChallenge,
          code_challenge_method: "S256",
          state: "s2",
          resource: "https://clockify-mcp.example.com/mcp",
          scope: "clockify.read clockify.admin"
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expectNoStore(response);
    expect(createClient).not.toHaveBeenCalled();
    expect(response.json()).toEqual({
      error: "invalid_oauth_request",
      error_description: "OAuth request validation failed."
    });
    expect(credentialStore.list({ ownerId: "clockify:user:clockify-user-1" })).toEqual([]);
    expect(JSON.stringify(response.json())).not.toContain("clockify-secret-api-key");
  });

  test("POST /api/onboarding/credential rejects missing OAuth context as an OAuth request error", async () => {
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 8).toString("base64") }
    });
    const credentialStore = new InMemoryCredentialStore({ cipher });
    const createClient = vi.fn(() => ({
      getProfile: vi.fn(async () => ({ id: "clockify-user-1", name: "Ada", email: "ada@example.com" }))
    }));
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      oauthService: testOAuthService(),
      credentialStore,
      createClient
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/onboarding/credential",
      payload: {
        clockifyApiKey: "clockify-secret-api-key"
      }
    });

    expect(response.statusCode).toBe(400);
    expectNoStore(response);
    expect(createClient).not.toHaveBeenCalled();
    expect(response.json()).toEqual({
      error: "invalid_oauth_request",
      error_description: "OAuth request validation failed."
    });
    expect(JSON.stringify(response.json())).not.toContain("clockify-secret-api-key");
  });

  test("POST /api/onboarding/credential validates Clockify key, stores credential, and redirects with OAuth code", async () => {
    const jwtSecret = "test-secret-with-at-least-32-bytes!";
    const oauthService = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret,
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"]
    });
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 8).toString("base64") }
    });
    const credentialStore = new InMemoryCredentialStore({ cipher });
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      oauthService,
      credentialStore,
      createClient: vi.fn(() => ({
        getProfile: vi.fn(async () => ({ id: "clockify-user-1", name: "Ada", email: "ada@example.com" }))
      }))
    });
    const verifier = testCodeVerifier;
    const challenge = testCodeChallenge;
    const response = await app.inject({
      method: "POST",
      url: "/api/onboarding/credential",
      payload: {
        clockifyApiKey: "clockify-secret-api-key",
        oauth: {
          response_type: "code",
          client_id: "chatgpt",
          redirect_uri: "https://chat.openai.com/aip/callback",
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: "s2",
          resource: "https://clockify-mcp.example.com/mcp",
          scope: "clockify.read"
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.pragma).toBe("no-cache");
    const body = response.json();
    expect(body.redirectTo).toContain("https://chat.openai.com/aip/callback");
    const redirectTo = new URL(body.redirectTo);
    expect(redirectTo.searchParams.get("state")).toBe("s2");
    expect(await credentialStore.decryptActiveByOwnerId({ ownerId: "clockify:user:clockify-user-1" })).toBe(
      "clockify-secret-api-key"
    );

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: {
        grant_type: "authorization_code",
        code: redirectTo.searchParams.get("code"),
        client_id: "chatgpt",
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: verifier,
        resource: "https://clockify-mcp.example.com/mcp"
      }
    });
    expect(tokenResponse.json()).toMatchObject({ token_type: "Bearer", scope: "clockify.read" });
  });

  test("POST /oauth/token rejects authorization code exchange with mismatched resource", async () => {
    const jwtSecret = "test-secret-with-at-least-32-bytes!";
    const oauthService = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret,
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"]
    });
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 8).toString("base64") }
    });
    const credentialStore = new InMemoryCredentialStore({ cipher });
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      oauthService,
      credentialStore,
      createClient: vi.fn(() => ({
        getProfile: vi.fn(async () => ({ id: "clockify-user-1", name: "Ada", email: "ada@example.com" }))
      }))
    });
    const verifier = testCodeVerifier;
    const challenge = testCodeChallenge;
    const onboardingResponse = await app.inject({
      method: "POST",
      url: "/api/onboarding/credential",
      payload: {
        clockifyApiKey: "clockify-secret-api-key",
        oauth: {
          response_type: "code",
          client_id: "chatgpt",
          redirect_uri: "https://chat.openai.com/aip/callback",
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: "s1",
          resource: "https://clockify-mcp.example.com/mcp",
          scope: "clockify.read"
        }
      }
    });
    const code = new URL(onboardingResponse.json().redirectTo).searchParams.get("code");
    expect(code).toEqual(expect.any(String));

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: {
        grant_type: "authorization_code",
        code,
        client_id: "chatgpt",
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: verifier,
        resource: "https://other.example.com/mcp"
      }
    });

    expect(tokenResponse.statusCode).toBe(400);
    expect(tokenResponse.headers["cache-control"]).toBe("no-store");
    expect(tokenResponse.headers.pragma).toBe("no-cache");
    expect(tokenResponse.json()).toMatchObject({ error: "invalid_grant" });
  });

  test("POST /api/onboarding/credential rejects invalid Clockify key without storing it", async () => {
    const jwtSecret = "test-secret-with-at-least-32-bytes!";
    const oauthService = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret,
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"]
    });
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 8).toString("base64") }
    });
    const credentialStore = new InMemoryCredentialStore({ cipher });
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      oauthService,
      credentialStore,
      createClient: vi.fn(() => ({
        getProfile: vi.fn(async () => {
          throw new Error("invalid api key");
        })
      }))
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/onboarding/credential",
      payload: {
        clockifyApiKey: "bad-key",
        oauth: {
          response_type: "code",
          client_id: "chatgpt",
          redirect_uri: "https://chat.openai.com/aip/callback",
          code_challenge: testCodeChallenge,
          code_challenge_method: "S256",
          state: "s3",
          resource: "https://clockify-mcp.example.com/mcp",
          scope: "clockify.read"
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(credentialStore.list({ ownerId: "clockify:user:clockify-user-1" })).toEqual([]);
    expect(JSON.stringify(response.json())).not.toContain("bad-key");
  });

  test("POST /mcp without bearer token returns OAuth challenge", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com" });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" }
    });

    expect(response.statusCode).toBe(401);
    expectNoStore(response);
    expect(response.headers["www-authenticate"]).toContain("Bearer");
    expect(response.headers["www-authenticate"]).toContain("/.well-known/oauth-protected-resource");
  });

  test("MCP POST route is not limited by the sensitive OAuth route limiter", async () => {
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      sensitiveRouteRateLimit: {
        max: 1,
        windowMs: 60_000
      }
    });

    const firstResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" }
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list" }
    });

    expect(firstResponse.statusCode).toBe(401);
    expect(secondResponse.statusCode).toBe(401);
  });

  test("POST /mcp tools/list with bearer token returns tool descriptors", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", skipTokenVerification: true });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" }
    });

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: expect.arrayContaining([expect.objectContaining({ name: "get_clockify_profile" })])
      }
    });
  });

  test("POST /mcp initialize with bearer token returns no-store server capabilities", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", skipTokenVerification: true });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize" }
    });

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: { name: "clockify-mcp", version: "0.1.0" },
        capabilities: { tools: {} }
      }
    });
  });

  test("POST /mcp notifications/initialized returns empty notification response", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", skipTokenVerification: true });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: { jsonrpc: "2.0", method: "notifications/initialized" }
    });

    expect(response.statusCode).toBe(202);
    expectNoStore(response);
    expect(response.body).toBe("");
  });

  test("POST /mcp ignores unknown JSON-RPC notifications", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", skipTokenVerification: true });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: { jsonrpc: "2.0", method: "notifications/cancelled" }
    });

    expect(response.statusCode).toBe(202);
    expectNoStore(response);
    expect(response.body).toBe("");
  });

  test("POST /mcp ignores implemented JSON-RPC notifications without a response body", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", skipTokenVerification: true });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: { jsonrpc: "2.0", method: "tools/list" }
    });

    expect(response.statusCode).toBe(202);
    expectNoStore(response);
    expect(response.body).toBe("");
  });

  test("POST /mcp rejects invalid JSON-RPC envelopes", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", skipTokenVerification: true });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: { jsonrpc: "1.0", id: 1, method: "tools/list" }
    });

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32600, message: "Invalid JSON-RPC request." }
    });
  });

  test("POST /mcp rejects JSON-RPC requests with invalid id values", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", skipTokenVerification: true });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: { jsonrpc: "2.0", id: { nested: 1 }, method: "tools/list" }
    });

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid JSON-RPC request." }
    });
  });

  test("POST /mcp rejects non-object params for tools/list", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", skipTokenVerification: true });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list", params: [] }
    });

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32602, message: "Invalid params." }
    });
  });

  test("POST /mcp unknown method returns JSON-RPC method not found", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", skipTokenVerification: true });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: { jsonrpc: "2.0", id: 99, method: "unknown/method" }
    });

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual({
      jsonrpc: "2.0",
      id: 99,
      error: { code: -32601, message: "MCP method is not implemented." }
    });
  });

  test("POST /mcp verifies JWT bearer token", async () => {
    const jwtSecret = "test-secret-with-at-least-32-bytes!";
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", jwtSecret });
    const accessToken = await issueAccessToken({
      secret: jwtSecret,
      issuer: "https://clockify-mcp.example.com",
      audience: "https://clockify-mcp.example.com/mcp",
      subject: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify.read"],
      expiresIn: "5m"
    });

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" }
    });

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json().result.tools.length).toBeGreaterThan(0);
  });

  test("POST /oauth/revoke revokes submitted JWT bearer token for future MCP calls", async () => {
    const jwtSecret = "test-secret-with-at-least-32-bytes!";
    const tokenRevocationStore = new InMemoryTokenRevocationStore();
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      jwtSecret,
      tokenRevocationStore
    });
    const accessToken = await issueAccessToken({
      secret: jwtSecret,
      issuer: "https://clockify-mcp.example.com",
      audience: "https://clockify-mcp.example.com/mcp",
      subject: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify.read"],
      expiresIn: "5m",
      tokenId: "token-id-1"
    });

    const allowedResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" }
    });
    expect(allowedResponse.statusCode).toBe(200);

    const revokeResponse = await app.inject({
      method: "POST",
      url: "/oauth/revoke",
      payload: { token: accessToken }
    });
    expect(revokeResponse.statusCode).toBe(200);
    expectNoStore(revokeResponse);
    expect(revokeResponse.json()).toEqual({});
    expect(tokenRevocationStore.revocations.get("token-id-1")).toMatchObject({
      ownerId: "owner-1",
      clientId: "chatgpt"
    });

    const revokedResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list" }
    });
    expect(revokedResponse.statusCode).toBe(401);
    expect(revokedResponse.headers["www-authenticate"]).toContain("Bearer");
  });

  test("DELETE /api/credential requires bearer token", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com" });
    const response = await app.inject({ method: "DELETE", url: "/api/credential" });

    expect(response.statusCode).toBe(401);
    expectNoStore(response);
    expect(response.headers["www-authenticate"]).toContain("Bearer");
    expect(response.headers["www-authenticate"]).toContain("/.well-known/oauth-protected-resource");
  });

  test("DELETE /api/credential returns no-store when credential storage is unavailable", async () => {
    const jwtSecret = "test-secret-with-at-least-32-bytes!";
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      jwtSecret
    });
    const accessToken = await issueAccessToken({
      secret: jwtSecret,
      issuer: "https://clockify-mcp.example.com",
      audience: "https://clockify-mcp.example.com/mcp",
      subject: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify.read"],
      expiresIn: "5m"
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/api/credential",
      headers: { authorization: `Bearer ${accessToken}` }
    });

    expect(response.statusCode).toBe(503);
    expectNoStore(response);
    expect(response.json()).toEqual({ error: "credential_store_unavailable" });
  });

  test("DELETE /api/credential deletes stored Clockify credential for token subject", async () => {
    const jwtSecret = "test-secret-with-at-least-32-bytes!";
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 9).toString("base64") }
    });
    const credentialStore = new InMemoryCredentialStore({ cipher });
    credentialStore.save({ ownerId: "owner-1", plaintext: "clockify-api-key" });
    credentialStore.save({ ownerId: "owner-2", plaintext: "other-clockify-api-key" });
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      jwtSecret,
      credentialStore
    });
    const accessToken = await issueAccessToken({
      secret: jwtSecret,
      issuer: "https://clockify-mcp.example.com",
      audience: "https://clockify-mcp.example.com/mcp",
      subject: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify.read"],
      expiresIn: "5m"
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/api/credential",
      headers: { authorization: `Bearer ${accessToken}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ deleted: true, deletedCount: 1 });
    expect(credentialStore.list({ ownerId: "owner-1" })).toEqual([]);
    expect(credentialStore.list({ ownerId: "owner-2" })).toHaveLength(1);
  });

  test("DELETE /api/credential rejects token with wrong audience without deleting credential", async () => {
    const jwtSecret = "test-secret-with-at-least-32-bytes!";
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 9).toString("base64") }
    });
    const credentialStore = new InMemoryCredentialStore({ cipher });
    credentialStore.save({ ownerId: "owner-1", plaintext: "clockify-api-key" });
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      jwtSecret,
      credentialStore
    });
    const accessToken = await issueAccessToken({
      secret: jwtSecret,
      issuer: "https://clockify-mcp.example.com",
      audience: "https://other.example.com/mcp",
      subject: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify.read"],
      expiresIn: "5m"
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/api/credential",
      headers: { authorization: `Bearer ${accessToken}` }
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("Bearer");
    expect(credentialStore.list({ ownerId: "owner-1" })).toHaveLength(1);
  });

  test("DELETE /api/credential rejects token with wrong issuer without deleting credential", async () => {
    const jwtSecret = "test-secret-with-at-least-32-bytes!";
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 9).toString("base64") }
    });
    const credentialStore = new InMemoryCredentialStore({ cipher });
    credentialStore.save({ ownerId: "owner-1", plaintext: "clockify-api-key" });
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      jwtSecret,
      credentialStore
    });
    const accessToken = await issueAccessToken({
      secret: jwtSecret,
      issuer: "https://other.example.com",
      audience: "https://clockify-mcp.example.com/mcp",
      subject: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify.read"],
      expiresIn: "5m"
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/api/credential",
      headers: { authorization: `Bearer ${accessToken}` }
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("Bearer");
    expect(credentialStore.list({ ownerId: "owner-1" })).toHaveLength(1);
  });

  test("DELETE /api/credential rejects revoked token without deleting credential", async () => {
    const jwtSecret = "test-secret-with-at-least-32-bytes!";
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 9).toString("base64") }
    });
    const credentialStore = new InMemoryCredentialStore({ cipher });
    credentialStore.save({ ownerId: "owner-1", plaintext: "clockify-api-key" });
    const tokenRevocationStore = new InMemoryTokenRevocationStore();
    tokenRevocationStore.revoke({ tokenId: "delete-token-id", ownerId: "owner-1", clientId: "chatgpt" });
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      jwtSecret,
      credentialStore,
      tokenRevocationStore
    });
    const accessToken = await issueAccessToken({
      secret: jwtSecret,
      issuer: "https://clockify-mcp.example.com",
      audience: "https://clockify-mcp.example.com/mcp",
      subject: "owner-1",
      clientId: "chatgpt",
      scopes: ["clockify.read"],
      expiresIn: "5m",
      tokenId: "delete-token-id"
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/api/credential",
      headers: { authorization: `Bearer ${accessToken}` }
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("Bearer");
    expect(credentialStore.list({ ownerId: "owner-1" })).toHaveLength(1);
  });

  test("POST /mcp tools/call uses linked credential and returns handler result", async () => {
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 9).toString("base64") }
    });
    const credentialStore = new InMemoryCredentialStore({ cipher });
    credentialStore.save({ ownerId: "test-subject", plaintext: "clockify-api-key" });
    const client = {
      getProfile: vi.fn(async () => ({ id: "u1", name: "Ada", email: "ada@example.com" })),
      listWorkspaces: vi.fn(async () => [{ id: "w1", name: "Personal" }])
    };
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      skipTokenVerification: true,
      credentialStore,
      createClient: vi.fn(() => client)
    });

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_clockify_profile", arguments: {} }
      }
    });

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: { structuredContent: { user: { id: "u1" } } }
    });
  });

  test("POST /mcp tools/call returns MCP OAuth challenge metadata when Clockify is not linked", async () => {
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 9).toString("base64") }
    });
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      skipTokenVerification: true,
      credentialStore: new InMemoryCredentialStore({ cipher })
    });

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_clockify_profile", arguments: {} }
      }
    });

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        isError: true,
        _meta: {
          "mcp/www_authenticate": [
            expect.stringContaining('resource_metadata="https://clockify-mcp.example.com/.well-known/oauth-protected-resource"')
          ]
        }
      }
    });
    const challenge = response.json().result._meta["mcp/www_authenticate"][0];
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain('error_description="Credential is unavailable"');
  });

  test("POST /mcp redacts secret-like fragments from authorization error metadata", async () => {
    const credentialStore = {
      save: vi.fn(),
      getActive: vi.fn(),
      getActiveByOwnerId: vi.fn(),
      decryptActive: vi.fn(),
      decryptActiveByOwnerId: vi.fn(async () => {
        throw new AuthorizationError(
          "Credential is unavailable x-api-key=secret-x-api-key api_key=secret-api-key apiKey=secret-api-camel code=secret-code state=secret-state"
        );
      }),
      revoke: vi.fn(),
      revokeActiveByOwnerId: vi.fn(),
      deleteByOwnerId: vi.fn(),
      list: vi.fn()
    };
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      skipTokenVerification: true,
      credentialStore
    });

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "get_clockify_profile", arguments: {} }
      }
    });

    const serialized = JSON.stringify(response.json());
    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(serialized).not.toContain("secret-x-api-key");
    expect(serialized).not.toContain("secret-api-key");
    expect(serialized).not.toContain("secret-api-camel");
    expect(serialized).not.toContain("secret-code");
    expect(serialized).not.toContain("secret-state");
    expect(response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 8,
      result: {
        isError: true,
        _meta: {
          "mcp/www_authenticate": [expect.stringContaining("x-api-key=[redacted]")]
        }
      }
    });
  });

  test("POST /mcp invalid tools/call params returns no-store JSON-RPC error", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", skipTokenVerification: true });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: { jsonrpc: "2.0", id: 5, method: "tools/call", params: {} }
    });

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual({
      jsonrpc: "2.0",
      id: 5,
      error: { code: -32602, message: "Invalid tools/call request." }
    });
  });

  test("POST /mcp redacts secret-like fragments from JSON-RPC tool errors", async () => {
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: Buffer.alloc(32, 9).toString("base64") }
    });
    const credentialStore = new InMemoryCredentialStore({ cipher });
    credentialStore.save({ ownerId: "test-subject", plaintext: "clockify-api-key" });
    const app = buildApp({
      publicBaseUrl: "https://clockify-mcp.example.com",
      skipTokenVerification: true,
      credentialStore,
      createClient: vi.fn(() => ({
        getProfile: vi.fn(async () => {
          throw new Error(
            "Clockify failed with Bearer secret-token-123 clockifyApiKey=secret-clockify-key code_verifier=secret-verifier x-api-key=secret-x-api-key api_key=secret-api-key apiKey=secret-api-camel code=secret-code state=secret-state"
          );
        })
      }))
    });

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "get_clockify_profile", arguments: {} }
      }
    });

    const serialized = JSON.stringify(response.json());
    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(serialized).not.toContain("secret-token-123");
    expect(serialized).not.toContain("secret-clockify-key");
    expect(serialized).not.toContain("secret-verifier");
    expect(serialized).not.toContain("secret-x-api-key");
    expect(serialized).not.toContain("secret-api-key");
    expect(serialized).not.toContain("secret-api-camel");
    expect(serialized).not.toContain("secret-code");
    expect(serialized).not.toContain("secret-state");
    expect(response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32000 }
    });
  });

  test.each([
    ["invalid token", { token: "invalid-token" }],
    ["empty body", {}]
  ])("POST /oauth/revoke returns no-store for %s", async (_name, payload) => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com" });
    const response = await app.inject({
      method: "POST",
      url: "/oauth/revoke",
      payload
    });

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual({});
  });

  test("GET /.well-known/mcp/server-card.json lists public server metadata", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com" });
    const response = await app.inject({ method: "GET", url: "/.well-known/mcp/server-card.json" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      serverInfo: {
        name: "clockify-mcp",
        version: "0.1.0"
      },
      authentication: {
        type: "oauth2"
      }
    });
  });

  test("public MCP metadata stays aligned with package and registry manifests", async () => {
    const app = buildApp({ publicBaseUrl: "https://clockify-mcp.example.com", skipTokenVerification: true });
    const serverCardResponse = await app.inject({ method: "GET", url: "/.well-known/mcp/server-card.json" });
    const initializeResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer test-token" },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize" }
    });

    expect(serverCardResponse.statusCode).toBe(200);
    expect(serverCardResponse.json().serverInfo).toMatchObject({
      name: packageJson.name,
      title: serverManifest.title,
      version: packageJson.version,
      description: serverManifest.description
    });
    expect(initializeResponse.json().result.serverInfo).toEqual({
      name: packageJson.name,
      version: packageJson.version
    });
  });
});
