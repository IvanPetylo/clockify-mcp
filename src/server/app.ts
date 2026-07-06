import { randomBytes } from "node:crypto";

import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import { AuthorizationError } from "../auth/authorization.js";
import { verifyAccessToken, type AccessTokenPayload, type TokenRevocationStore } from "../auth/jwt.js";
import type { createOAuthService } from "../auth/oauth.js";
import { redactSecrets } from "../auth/redaction.js";
import { listClockifyTools } from "../mcp/tools.js";
import { callClockifyTool, type ClockifyClientLike } from "../mcp/handlers.js";
import type { CredentialStore } from "../db/credential-store.js";
import { jsonRpcError, jsonRpcInvalidParams, jsonRpcInvalidRequest, jsonRpcMethodNotFound } from "./json-rpc.js";
import packageJson from "../../package.json" with { type: "json" };
import serverManifest from "../../server.json" with { type: "json" };

export type AppOptions = {
  publicBaseUrl?: string;
  trustProxy?: boolean | number;
  skipTokenVerification?: boolean;
  jwtSecret?: Uint8Array | string;
  credentialStore?: CredentialStore;
  tokenRevocationStore?: TokenRevocationStore;
  createClient?: (apiKey: string) => ClockifyClientLike;
  oauthService?: ReturnType<typeof createOAuthService>;
  healthCheck?: () => Promise<void> | void;
  sensitiveRouteRateLimit?: {
    max: number;
    windowMs: number;
  };
};

const scopes = ["clockify.read", "clockify.time.write", "clockify.time.delete"];
const sensitivePostRoutePaths = new Set(["/oauth/token", "/oauth/revoke", "/onboarding", "/api/onboarding/credential"]);
const sensitiveResponseRoutePaths = new Set([
  ...sensitivePostRoutePaths,
  "/api/credential",
  "/mcp",
  "/oauth/authorize"
]);
const publicServerInfo = {
  name: packageJson.name,
  title: serverManifest.title,
  version: packageJson.version,
  description: serverManifest.description
};

class OAuthRequestValidationError extends Error {
  constructor() {
    super("OAuth request validation failed.");
    this.name = "OAuthRequestValidationError";
  }
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const publicBaseUrl = (options.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  const app = Fastify({ logger: false, trustProxy: options.trustProxy });

  void app.register(helmet, {
    contentSecurityPolicy: false
  });
  void app.register(cors, {
    origin: false
  });
  void app.register(formbody);
  registerSensitiveRouteRateLimit(app, options.sensitiveRouteRateLimit);
  registerSensitiveErrorHandler(app);

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/readyz", async (_request, reply) => {
    try {
      await options.healthCheck?.();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  app.get("/privacy", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(renderPublicInfoPage("Privacy Policy", privacyPolicyHtml()))
  );

  app.get("/terms", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(renderPublicInfoPage("Terms of Service", termsOfServiceHtml()))
  );

  app.get("/.well-known/oauth-protected-resource", async () => ({
    resource: `${publicBaseUrl}/mcp`,
    authorization_servers: [publicBaseUrl],
    scopes_supported: scopes,
    bearer_methods_supported: ["header"]
  }));

  app.get("/.well-known/oauth-authorization-server", async () => ({
    issuer: publicBaseUrl,
    authorization_endpoint: `${publicBaseUrl}/oauth/authorize`,
    token_endpoint: `${publicBaseUrl}/oauth/token`,
    revocation_endpoint: `${publicBaseUrl}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: scopes
  }));

  app.get("/oauth/authorize", async (request, reply) => {
    markSensitiveResponse(reply);
    if (!options.oauthService) {
      return reply.code(503).send({ error: "oauth_unavailable" });
    }
    const query = request.query as Record<string, string | undefined>;
    try {
      validateOAuthRequest({ oauth: query, options });
    } catch {
      return sendOAuthValidationErrorPage(reply.code(400));
    }
    const onboardingUrl = new URL(`${publicBaseUrl}/onboarding`);
    copyOAuthParams(query, onboardingUrl.searchParams);
    return reply.redirect(onboardingUrl.toString());
  });

  app.get("/onboarding", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (!options.oauthService) {
      return sendOAuthValidationErrorPage(reply.code(503));
    }
    try {
      validateOAuthRequest({ oauth: query, options });
    } catch {
      return sendOAuthValidationErrorPage(reply.code(400));
    }
    return sendOnboardingPage(reply, { oauth: query });
  });

  app.post("/onboarding", async (request, reply) => {
    const body = recordBody(request.body) as Record<string, string | undefined>;
    try {
      const redirectTo = await completeOnboarding({
        body: {
          clockifyApiKey: body.clockifyApiKey,
          oauth: body
        },
        options
      });
      return markSensitiveResponse(reply).redirect(redirectTo);
    } catch (error) {
      if (error instanceof OAuthRequestValidationError) {
        return sendOAuthValidationErrorPage(reply.code(400));
      }
      return sendOnboardingPage(reply.code(400), {
        oauth: body,
        error: "Clockify API key validation failed."
      });
    }
  });

  app.post("/oauth/token", async (request, reply) => {
    markSensitiveResponse(reply);
    if (!options.oauthService) {
      return reply.code(503).send({ error: "oauth_unavailable" });
    }
    const body = recordBody(request.body) as Record<string, string | undefined>;
    if (body.grant_type !== "authorization_code") {
      return reply.code(400).send({ error: "unsupported_grant_type" });
    }
    try {
      return await options.oauthService.exchangeAuthorizationCode({
        code: body.code ?? "",
        client_id: body.client_id ?? "",
        redirect_uri: body.redirect_uri ?? "",
        code_verifier: body.code_verifier ?? "",
        resource: body.resource ?? ""
      });
    } catch (error) {
      markSensitiveResponse(reply);
      return reply.code(400).send({
        error: "invalid_grant",
        error_description: error instanceof Error ? error.message : "Invalid authorization code"
      });
    }
  });

  app.post("/oauth/revoke", async (request, reply) => {
    markSensitiveResponse(reply);
    const token = revocationToken(request.body);
    if (token && options.jwtSecret && options.tokenRevocationStore) {
      try {
        const payload = await verifyAccessToken(token, {
          secret: options.jwtSecret,
          issuer: publicBaseUrl,
          audience: `${publicBaseUrl}/mcp`
        });
        if (payload.jti) {
          await options.tokenRevocationStore.revoke({
            tokenId: payload.jti,
            ownerId: payload.sub,
            clientId: payload.clientId,
            expiresAt: payload.exp ? new Date(payload.exp * 1000) : undefined
          });
        }
      } catch {
        // OAuth token revocation is intentionally idempotent and does not disclose token validity.
      }
    }
    return reply.code(200).send({});
  });

  app.post("/api/onboarding/credential", async (request, reply) => {
    markSensitiveResponse(reply);
    if (!options.oauthService || !options.credentialStore) {
      return reply.code(503).send({ error: "onboarding_unavailable" });
    }
    const body = recordBody(request.body) as {
      clockifyApiKey?: string;
      oauth?: Record<string, string | undefined>;
    };
    if (!body.oauth) {
      return reply.code(400).send({
        error: "invalid_oauth_request",
        error_description: "OAuth request validation failed."
      });
    }
    if (!body.clockifyApiKey) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      return {
        redirectTo: await completeOnboarding({ body, options })
      };
    } catch (error) {
      markSensitiveResponse(reply);
      if (error instanceof OAuthRequestValidationError) {
        return reply.code(400).send({
          error: "invalid_oauth_request",
          error_description: "OAuth request validation failed."
        });
      }
      return reply.code(400).send({
        error: "invalid_clockify_api_key",
        error_description: error instanceof Error ? "Clockify API key validation failed" : "Invalid Clockify API key"
      });
    }
  });

  app.delete("/api/credential", async (request, reply) => {
    markSensitiveResponse(reply);
    const token = await authenticateRequest(authorizationToken(request.headers.authorization), {
      publicBaseUrl,
      options
    });
    if (!token) {
      return reply
        .code(401)
        .header(
          "www-authenticate",
          `Bearer resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource"`
        )
        .send({
          error: "unauthorized",
          error_description: "Connect ClockifyMCP before deleting stored Clockify credentials."
        });
    }
    if (!options.credentialStore) {
      return reply.code(503).send({ error: "credential_store_unavailable" });
    }

    const deletedCount = await options.credentialStore.deleteByOwnerId({ ownerId: token.sub });
    return reply.send({
      deleted: deletedCount > 0,
      deletedCount
    });
  });

  app.get("/.well-known/mcp/server-card.json", async () => ({
    serverInfo: {
      ...publicServerInfo,
      privacyPolicyUrl: `${publicBaseUrl}/privacy`,
      termsOfServiceUrl: `${publicBaseUrl}/terms`,
      supportEmail: "petylo.work+mcp@gmail.com"
    },
    authentication: {
      type: "oauth2",
      authorizationUrl: `${publicBaseUrl}/oauth/authorize`,
      tokenUrl: `${publicBaseUrl}/oauth/token`,
      scopes
    },
    tools: listClockifyTools().map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description
    }))
  }));

  app.post("/mcp", async (request, reply) => {
    markSensitiveResponse(reply);
    const token = await authenticateRequest(authorizationToken(request.headers.authorization), {
      publicBaseUrl,
      options
    });
    if (!token) {
      return reply
        .code(401)
        .header(
          "www-authenticate",
          `Bearer resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource"`
        )
        .send({
          error: "unauthorized",
          error_description: "Connect ClockifyMCP before calling MCP tools."
        });
    }

    const body = request.body;
    if (!isJsonRpcRequest(body)) {
      return reply.send(jsonRpcInvalidRequest(jsonRpcRequestId(body)));
    }

    if (body.id === undefined) {
      return reply.code(202).send();
    }
    if (body.params !== undefined && !isRecord(body.params)) {
      return reply.send(jsonRpcInvalidParams(body.id));
    }

    if (body?.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: body.id ?? null,
        result: {
          protocolVersion: "2025-06-18",
          serverInfo: { name: publicServerInfo.name, version: publicServerInfo.version },
          capabilities: { tools: {} }
        }
      };
    }

    if (body?.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id: body.id ?? null,
        result: {
          tools: listClockifyTools()
        }
      };
    }

    if (body?.method === "tools/call") {
      const params = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name || !options.credentialStore) {
        return reply.send(jsonRpcInvalidParams(body.id, "Invalid tools/call request."));
      }
      try {
        const result = await callClockifyTool({
          name: params.name,
          arguments: params.arguments ?? {},
          token,
          credentialStore: options.credentialStore,
          createClient: options.createClient
        });
        return { jsonrpc: "2.0", id: body.id ?? null, result };
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return {
            jsonrpc: "2.0",
            id: body.id ?? null,
            result: mcpAuthErrorResult({
              publicBaseUrl,
              description: safeErrorMessage(error, "Authentication required")
            })
          };
        }
        return reply.send(jsonRpcError(body.id, -32000, safeErrorMessage(error, "Tool call failed.")));
      }
    }

    return reply.send(jsonRpcMethodNotFound(body.id));
  });

  return app;
}

function authorizationToken(header: string | undefined): string | undefined {
  const [scheme, token] = header?.split(/\s+/, 2) ?? [];
  return scheme?.toLowerCase() === "bearer" ? token : undefined;
}

function revocationToken(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const token = (body as { token?: unknown }).token;
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

function recordBody(body: unknown): Record<string, unknown> {
  return isRecord(body) ? body : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isJsonRpcRequest(body: unknown): body is { jsonrpc: "2.0"; id?: unknown; method: string; params?: unknown } {
  if (!isRecord(body)) return false;
  const request = body as { jsonrpc?: unknown; method?: unknown };
  return request.jsonrpc === "2.0" && typeof request.method === "string" && isJsonRpcId((body as { id?: unknown }).id);
}

function jsonRpcRequestId(body: unknown): unknown {
  if (!isRecord(body)) return undefined;
  const id = body.id;
  return isJsonRpcId(id) ? id : undefined;
}

function isJsonRpcId(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

async function completeOnboarding(input: {
  body: {
    clockifyApiKey?: string;
    oauth?: Record<string, string | undefined>;
  };
  options: AppOptions;
}): Promise<string> {
  if (!input.options.oauthService || !input.options.credentialStore) {
    throw new Error("Onboarding is unavailable");
  }
  const apiKey = input.body.clockifyApiKey;
  const oauth = input.body.oauth;
  if (!apiKey || !oauth) {
    throw new Error("Invalid onboarding request");
  }
  validateOAuthRequest({ oauth, options: input.options });
  const client = input.options.createClient?.(apiKey);
  if (!client?.getProfile) {
    throw new Error("Clockify validation unavailable");
  }
  const profile = (await client.getProfile()) as { id?: unknown };
  if (typeof profile.id !== "string" || profile.id.length === 0) {
    throw new Error("Invalid Clockify profile");
  }

  const subject = `clockify:user:${profile.id}`;
  const authorization = await input.options.oauthService.createAuthorizationCode({
    response_type: oauth.response_type ?? "",
    client_id: oauth.client_id ?? "",
    redirect_uri: oauth.redirect_uri ?? "",
    code_challenge: oauth.code_challenge ?? "",
    code_challenge_method: oauth.code_challenge_method ?? "",
    state: oauth.state ?? "",
    resource: oauth.resource ?? "",
    scope: oauth.scope ?? "",
    subject
  });
  await input.options.credentialStore.save({ ownerId: subject, plaintext: apiKey });
  const redirectTo = new URL(oauth.redirect_uri ?? "");
  redirectTo.searchParams.set("code", authorization.code);
  redirectTo.searchParams.set("state", authorization.state);
  return redirectTo.toString();
}

function validateOAuthRequest(input: { oauth: Record<string, string | undefined>; options: AppOptions }): void {
  try {
    input.options.oauthService?.validateAuthorizationRequest({
      response_type: input.oauth.response_type ?? "",
      client_id: input.oauth.client_id ?? "",
      redirect_uri: input.oauth.redirect_uri ?? "",
      code_challenge: input.oauth.code_challenge ?? "",
      code_challenge_method: input.oauth.code_challenge_method ?? "",
      state: input.oauth.state ?? "",
      resource: input.oauth.resource ?? "",
      scope: input.oauth.scope ?? ""
    });
  } catch {
    throw new OAuthRequestValidationError();
  }
}

function copyOAuthParams(source: Record<string, string | undefined>, target: URLSearchParams): void {
  for (const name of [
    "response_type",
    "client_id",
    "redirect_uri",
    "code_challenge",
    "code_challenge_method",
    "state",
    "resource",
    "scope"
  ]) {
    const value = source[name];
    if (value) {
      target.set(name, value);
    }
  }
}

function sendOnboardingPage(
  reply: FastifyReply,
  input: { oauth: Record<string, string | undefined>; error?: string }
): FastifyReply {
  const nonce = randomBytes(16).toString("base64");
  return markSensitiveResponse(reply)
    .header("content-security-policy", onboardingContentSecurityPolicy(nonce))
    .type("text/html; charset=utf-8")
    .send(renderOnboardingPage({ ...input, nonce }));
}

function sendOAuthValidationErrorPage(reply: FastifyReply): FastifyReply {
  const nonce = randomBytes(16).toString("base64");
  return markSensitiveResponse(reply)
    .header("content-security-policy", onboardingContentSecurityPolicy(nonce))
    .type("text/html; charset=utf-8")
    .send(renderOAuthValidationErrorPage(nonce));
}

function renderPublicInfoPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - ClockifyMCP</title>
  <style>
    body { color: #171717; font: 16px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; }
    main { margin: 0 auto; max-width: 760px; padding: 48px 24px; }
    h1 { font-size: 32px; line-height: 1.2; margin: 0 0 24px; }
    h2 { font-size: 20px; margin: 32px 0 8px; }
    p, li { color: #333; }
    ul { padding-left: 24px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${body}
  </main>
</body>
</html>`;
}

function privacyPolicyHtml(): string {
  return `<p>ClockifyMCP processes Clockify account data only to provide user-requested time-tracking actions through MCP clients such as ChatGPT.</p>
<p>Operator contact: Ivan Petylo, petylo.work+mcp@gmail.com, Telegram: @edwy_reed.</p>
<h2>Data Processed</h2>
<ul>
  <li>Clockify user profile and workspace identifiers.</li>
  <li>Project, task, client, tag, time-entry, timer, and report data returned by Clockify.</li>
  <li>Encrypted Clockify API key ciphertext and non-secret credential metadata.</li>
  <li>OAuth account-linking metadata such as subject, client id, scopes, and timestamps.</li>
</ul>
<h2>Use and Retention</h2>
<p>Data is used to execute MCP tool calls requested by the authenticated user, maintain account linking, support account disconnection, and diagnose operational failures with redacted logs.</p>
<p>Encrypted Clockify credentials remain stored until the user disconnects ClockifyMCP or requests deletion.</p>
<h2>Sharing</h2>
<p>ClockifyMCP sends requests to Clockify on behalf of the authenticated user. It does not sell user data.</p>
<h2>User Controls</h2>
<p>Users can disconnect ClockifyMCP by deleting stored credentials through the authenticated disconnect endpoint or by contacting petylo.work+mcp@gmail.com.</p>`;
}

function termsOfServiceHtml(): string {
  return `<p>ClockifyMCP is provided as an integration for personal Clockify time tracking through MCP-compatible clients.</p>
<p>Operator contact: Ivan Petylo, petylo.work+mcp@gmail.com, Telegram: @edwy_reed.</p>
<h2>User Responsibilities</h2>
<p>Users are responsible for ensuring they have permission to connect their Clockify account and use the exposed actions. Users must not submit API keys or data that they are not authorized to use.</p>
<h2>Service Scope</h2>
<p>The first release is limited to personal time-tracking workflows. ClockifyMCP does not provide team administration, billing, HR, payroll, or organization management features.</p>
<h2>Credential Handling</h2>
<p>ClockifyMCP validates the Clockify API key provided during onboarding and stores it encrypted. Users can request credential deletion through the service disconnect path or by contacting petylo.work+mcp@gmail.com.</p>
<h2>Third Parties</h2>
<p>ClockifyMCP is not affiliated with or endorsed by Clockify, CAKE.com, or OpenAI unless a marketplace listing states otherwise after approval.</p>`;
}

function markSensitiveResponse(reply: FastifyReply): FastifyReply {
  return reply.header("cache-control", "no-store").header("pragma", "no-cache");
}

function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const redacted = redactSecrets(error);
  const message = typeof redacted.message === "string" ? redacted.message : fallback;
  return message || fallback;
}

function registerSensitiveRouteRateLimit(
  app: FastifyInstance,
  options: AppOptions["sensitiveRouteRateLimit"]
): void {
  if (!options) return;
  const attempts = new Map<string, { count: number; resetAt: number }>();

  app.addHook("preHandler", async (request, reply) => {
    const routePath = request.url.split("?", 1)[0];
    if (request.method !== "POST" || !sensitivePostRoutePaths.has(routePath)) {
      return;
    }

    const now = Date.now();
    purgeExpiredAttempts(attempts, now);
    const key = `${request.ip}:${routePath}`;
    const current = attempts.get(key);
    const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + options.windowMs } : current;
    entry.count += 1;
    attempts.set(key, entry);

    if (entry.count > options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      return reply
        .code(429)
        .header("retry-after", String(retryAfterSeconds))
        .header("cache-control", "no-store")
        .header("pragma", "no-cache")
        .send({
          error: "rate_limited",
          error_description: "Too many attempts. Retry later."
        });
    }
  });
}

function registerSensitiveErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const routePath = request.url.split("?", 1)[0];
    if (sensitiveResponseRoutePaths.has(routePath)) {
      markSensitiveResponse(reply);
    }
    const statusCode = errorStatusCode(error);
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "internal_server_error" : "invalid_request"
    });
  });
}

function errorStatusCode(error: unknown): number {
  if (isRecord(error) && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return 500;
}

function purgeExpiredAttempts(attempts: Map<string, { count: number; resetAt: number }>, now: number): void {
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) {
      attempts.delete(key);
    }
  }
}

function mcpAuthErrorResult(input: { publicBaseUrl: string; description: string }): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
  _meta: { "mcp/www_authenticate": string[] };
} {
  const description = input.description.replace(/["\\]/g, "");
  return {
    content: [{ type: "text", text: `Authentication required: ${description}.` }],
    isError: true,
    _meta: {
      "mcp/www_authenticate": [
        `Bearer resource_metadata="${input.publicBaseUrl}/.well-known/oauth-protected-resource", error="invalid_token", error_description="${description}"`
      ]
    }
  };
}

function onboardingContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'none'",
    "script-src 'none'",
    `style-src 'nonce-${nonce}'`
  ].join("; ");
}

function renderOnboardingPage(input: {
  oauth: Record<string, string | undefined>;
  nonce: string;
  error?: string;
}): string {
  const hiddenInputs = [
    "response_type",
    "client_id",
    "redirect_uri",
    "code_challenge",
    "code_challenge_method",
    "state",
    "resource",
    "scope"
  ]
    .map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(input.oauth[name] ?? "")}">`)
    .join("\n");
  const error = input.error ? `<p class="error" role="alert">${escapeHtml(input.error)}</p>` : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect Clockify</title>
  <style nonce="${escapeHtml(input.nonce)}">
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #17202a;
      background: #f5f7fb;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    main {
      width: min(100%, 440px);
      background: #ffffff;
      border: 1px solid #d9e0ea;
      border-radius: 8px;
      padding: 28px;
      box-shadow: 0 16px 40px rgb(23 32 42 / 10%);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 24px;
      line-height: 1.2;
    }
    p {
      margin: 0 0 18px;
      line-height: 1.5;
      color: #4b5b6b;
    }
    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 650;
    }
    input[type="password"] {
      box-sizing: border-box;
      width: 100%;
      min-height: 44px;
      border: 1px solid #aeb9c6;
      border-radius: 6px;
      padding: 10px 12px;
      font: inherit;
    }
    button {
      width: 100%;
      min-height: 44px;
      margin-top: 16px;
      border: 0;
      border-radius: 6px;
      background: #1769e0;
      color: #ffffff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .error {
      padding: 10px 12px;
      border-radius: 6px;
      background: #fff0f0;
      color: #9f1d1d;
    }
    .note {
      margin-top: 14px;
      margin-bottom: 0;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main>
    <h1>Connect Clockify</h1>
    <p>Enter a Clockify API key so ClockifyMCP can use your personal time tracking data through this OAuth connection.</p>
    ${error}
    <form method="post" action="/onboarding" autocomplete="off">
      ${hiddenInputs}
      <label for="clockifyApiKey">Clockify API key</label>
      <input id="clockifyApiKey" name="clockifyApiKey" type="password" required autocomplete="off">
      <button type="submit">Connect Clockify</button>
    </form>
    <p class="note">The key is validated with Clockify and stored encrypted. It is never returned to ChatGPT.</p>
  </main>
</body>
</html>`;
}

function renderOAuthValidationErrorPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OAuth request validation failed</title>
  <style nonce="${escapeHtml(nonce)}">
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #17202a;
      background: #f5f7fb;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    main {
      width: min(100%, 440px);
      background: #ffffff;
      border: 1px solid #d9e0ea;
      border-radius: 8px;
      padding: 28px;
      box-shadow: 0 16px 40px rgb(23 32 42 / 10%);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 24px;
      line-height: 1.2;
    }
    p {
      margin: 0;
      line-height: 1.5;
      color: #4b5b6b;
    }
  </style>
</head>
<body>
  <main>
    <h1>OAuth request validation failed</h1>
    <p>Return to ChatGPT and start the Clockify connection again.</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function authenticateRequest(
  bearerToken: string | undefined,
  input: { publicBaseUrl: string; options: AppOptions }
): Promise<AccessTokenPayload | undefined> {
  if (!bearerToken) return undefined;
  if (input.options.skipTokenVerification) {
    return {
      sub: "test-subject",
      clientId: "test-client",
      scopes,
      exp: Math.floor(Date.now() / 1000) + 3600
    };
  }
  if (!input.options.jwtSecret) {
    return undefined;
  }
  try {
    return await verifyAccessToken(bearerToken, {
      secret: input.options.jwtSecret,
      issuer: input.publicBaseUrl,
      audience: `${input.publicBaseUrl}/mcp`,
      revocationStore: input.options.tokenRevocationStore
    });
  } catch {
    return undefined;
  }
}
