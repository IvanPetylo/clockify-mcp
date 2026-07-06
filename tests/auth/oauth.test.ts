import { createHash } from "node:crypto";

import { createOAuthService, InMemoryAuthorizationCodeStore } from "../../src/auth/oauth.js";

const codeVerifier = "a".repeat(43);
const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

const validAuthorizeRequest = {
  response_type: "code",
  client_id: "chatgpt",
  redirect_uri: "https://chat.openai.com/aip/callback",
  code_challenge: codeChallenge,
  code_challenge_method: "S256",
  state: "state-123",
  resource: "https://clockify-mcp.example.com/mcp",
  scope: "clockify.read clockify.time.write"
};

describe("OAuth authorization service", () => {
  test("creates and exchanges authorization code with PKCE S256", async () => {
    const service = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"]
    });

    const authorization = await service.createAuthorizationCode({ ...validAuthorizeRequest, subject: "owner-1" });
    const token = await service.exchangeAuthorizationCode({
      code: authorization.code,
      client_id: "chatgpt",
      redirect_uri: "https://chat.openai.com/aip/callback",
      code_verifier: codeVerifier,
      resource: "https://clockify-mcp.example.com/mcp"
    });

    expect(token).toMatchObject({
      token_type: "Bearer",
      scope: "clockify.read clockify.time.write",
      expires_in: 3600
    });
    expect(token.access_token).toEqual(expect.any(String));
  });

  test("exchanges authorization code through a shared store after service recreation", async () => {
    const authorizationCodeStore = new InMemoryAuthorizationCodeStore();
    const firstService = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"],
      authorizationCodeStore
    });
    const secondService = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"],
      authorizationCodeStore
    });

    const authorization = await firstService.createAuthorizationCode({
      ...validAuthorizeRequest,
      subject: "owner-1"
    });

    await expect(
      secondService.exchangeAuthorizationCode({
        code: authorization.code,
        client_id: "chatgpt",
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: codeVerifier,
        resource: "https://clockify-mcp.example.com/mcp"
      })
    ).resolves.toMatchObject({
      token_type: "Bearer",
      scope: "clockify.read clockify.time.write"
    });
  });

  test("rejects missing PKCE S256 and unregistered redirect URI", async () => {
    const service = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"]
    });

    await expect(
      service.createAuthorizationCode({
        ...validAuthorizeRequest,
        subject: "owner-1",
        code_challenge_method: "plain"
      })
    ).rejects.toThrow(/pkce/i);

    await expect(
      service.createAuthorizationCode({
        ...validAuthorizeRequest,
        subject: "owner-1",
        redirect_uri: "https://evil.example/callback"
      })
    ).rejects.toThrow(/redirect/i);
  });

  test("rejects malformed PKCE code challenges before saving an authorization code", async () => {
    const savedCodes: unknown[] = [];
    const service = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"],
      authorizationCodeStore: {
        saveAuthorizationCode(record) {
          savedCodes.push(record);
        },
        getAuthorizationCode() {
          return undefined;
        },
        consumeAuthorizationCode() {
          return undefined;
        }
      }
    });

    for (const invalidChallenge of ["too-short", `${"a".repeat(42)}!`]) {
      await expect(
        service.createAuthorizationCode({
          ...validAuthorizeRequest,
          subject: "owner-1",
          code_challenge: invalidChallenge
        })
      ).rejects.toThrow(/pkce/i);
    }
    expect(savedCodes).toEqual([]);
  });

  test("rejects missing client id at authorization time", async () => {
    const service = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"]
    });

    await expect(
      service.createAuthorizationCode({
        ...validAuthorizeRequest,
        subject: "owner-1",
        client_id: ""
      })
    ).rejects.toThrow(/client/i);
  });

  test("rejects unsupported requested scopes before saving an authorization code", async () => {
    const savedCodes: unknown[] = [];
    const service = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"],
      allowedScopes: ["clockify.read", "clockify.time.write", "clockify.time.delete"],
      authorizationCodeStore: {
        saveAuthorizationCode(record) {
          savedCodes.push(record);
        },
        getAuthorizationCode() {
          return undefined;
        },
        consumeAuthorizationCode() {
          return undefined;
        }
      }
    });

    await expect(
      service.createAuthorizationCode({
        ...validAuthorizeRequest,
        subject: "owner-1",
        scope: "clockify.read clockify.admin"
      })
    ).rejects.toThrow(/scope/i);
    expect(savedCodes).toEqual([]);
  });

  test("does not consume authorization code when PKCE verification fails", async () => {
    const service = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"]
    });
    const authorization = await service.createAuthorizationCode({ ...validAuthorizeRequest, subject: "owner-1" });

    await expect(
      service.exchangeAuthorizationCode({
        code: authorization.code,
        client_id: "chatgpt",
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: "b".repeat(43),
        resource: "https://clockify-mcp.example.com/mcp"
      })
    ).rejects.toThrow(/pkce/i);

    await expect(
      service.exchangeAuthorizationCode({
        code: authorization.code,
        client_id: "chatgpt",
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: codeVerifier,
        resource: "https://clockify-mcp.example.com/mcp"
      })
    ).resolves.toMatchObject({
      token_type: "Bearer",
      scope: "clockify.read clockify.time.write"
    });
  });

  test("binds authorization code to the original OAuth resource", async () => {
    const authorizationCodeStore = new InMemoryAuthorizationCodeStore();
    const issuingService = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"],
      authorizationCodeStore
    });
    const otherResourceService = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://other.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"],
      authorizationCodeStore
    });
    const authorization = await issuingService.createAuthorizationCode({
      ...validAuthorizeRequest,
      subject: "owner-1"
    });

    await expect(
      otherResourceService.exchangeAuthorizationCode({
        code: authorization.code,
        client_id: "chatgpt",
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: codeVerifier,
        resource: "https://other.example.com/mcp"
      })
    ).rejects.toThrow(/resource/i);
  });

  test("rejects non-compliant PKCE verifiers without consuming authorization code", async () => {
    const service = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"]
    });
    const authorization = await service.createAuthorizationCode({ ...validAuthorizeRequest, subject: "owner-1" });

    for (const invalidVerifier of ["short", `${"a".repeat(42)}!`]) {
      await expect(
        service.exchangeAuthorizationCode({
          code: authorization.code,
          client_id: "chatgpt",
          redirect_uri: "https://chat.openai.com/aip/callback",
          code_verifier: invalidVerifier,
          resource: "https://clockify-mcp.example.com/mcp"
        })
      ).rejects.toThrow(/pkce/i);
    }

    await expect(
      service.exchangeAuthorizationCode({
        code: authorization.code,
        client_id: "chatgpt",
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: codeVerifier,
        resource: "https://clockify-mcp.example.com/mcp"
      })
    ).resolves.toMatchObject({ token_type: "Bearer" });
  });

  test("rejects code replay", async () => {
    const service = createOAuthService({
      issuer: "https://clockify-mcp.example.com",
      resource: "https://clockify-mcp.example.com/mcp",
      jwtSecret: "test-secret-with-at-least-32-bytes!",
      allowedRedirectUris: ["https://chat.openai.com/aip/callback"]
    });
    const authorization = await service.createAuthorizationCode({ ...validAuthorizeRequest, subject: "owner-1" });

    await service.exchangeAuthorizationCode({
      code: authorization.code,
      client_id: "chatgpt",
      redirect_uri: "https://chat.openai.com/aip/callback",
      code_verifier: codeVerifier,
      resource: "https://clockify-mcp.example.com/mcp"
    });

    await expect(
      service.exchangeAuthorizationCode({
        code: authorization.code,
        client_id: "chatgpt",
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: codeVerifier,
        resource: "https://clockify-mcp.example.com/mcp"
      })
    ).rejects.toThrow(/invalid/i);
  });
});
