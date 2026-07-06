import { redactSecrets } from "../../src/auth/redaction.js";

describe("redactSecrets", () => {
  test("removes fake secrets from headers, query, body, and error-like objects", () => {
    const redacted = redactSecrets({
      headers: {
        Authorization: "Bearer fake-token-123",
        cookie: "session=fake-cookie",
        "x-api-key": "clockify-key-123",
        "content-type": "application/json"
      },
      query: {
        code: "oauth-code",
        state: "oauth-state",
        code_verifier: "oauth-verifier",
        search: "safe"
      },
      body: {
        access_token: "access-token",
        refreshToken: "refresh-token",
        client_secret: "client-secret",
        nested: {
          apiKey: "nested-api-key"
        }
      },
      error: new Error("Authorization Bearer fake-token-123 with client_secret=client-secret")
    });

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("fake-token-123");
    expect(serialized).not.toContain("fake-cookie");
    expect(serialized).not.toContain("clockify-key-123");
    expect(serialized).not.toContain("oauth-code");
    expect(serialized).not.toContain("oauth-state");
    expect(serialized).not.toContain("oauth-verifier");
    expect(serialized).not.toContain("access-token");
    expect(serialized).not.toContain("refresh-token");
    expect(serialized).not.toContain("client-secret");
    expect(serialized).not.toContain("nested-api-key");
    expect(redacted).toMatchObject({
      headers: {
        Authorization: "[redacted]",
        cookie: "[redacted]",
        "x-api-key": "[redacted]",
        "content-type": "application/json"
      },
      query: {
        code: "[redacted]",
        state: "[redacted]",
        code_verifier: "[redacted]",
        search: "safe"
      }
    });
  });

  test("removes camelCase secret aliases from nested objects and Error properties", () => {
    const error = new Error("failed request") as Error & Record<string, unknown>;
    error.clockifyApiKey = "error-clockify-key";
    error.accessToken = "error-access-token";
    error.idToken = "error-id-token";
    error.codeVerifier = "error-code-verifier";
    error.clientSecret = "error-client-secret";
    error.nested = {
      clockifyApiKey: "nested-clockify-key",
      accessToken: "nested-access-token",
      idToken: "nested-id-token",
      codeVerifier: "nested-code-verifier",
      clientSecret: "nested-client-secret"
    };

    const redacted = redactSecrets({
      clockifyApiKey: "root-clockify-key",
      accessToken: "root-access-token",
      idToken: "root-id-token",
      codeVerifier: "root-code-verifier",
      clientSecret: "root-client-secret",
      nested: {
        clockifyApiKey: "deep-clockify-key",
        accessToken: "deep-access-token",
        idToken: "deep-id-token",
        codeVerifier: "deep-code-verifier",
        clientSecret: "deep-client-secret"
      },
      error
    });

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("clockify-key");
    expect(serialized).not.toContain("access-token");
    expect(serialized).not.toContain("id-token");
    expect(serialized).not.toContain("code-verifier");
    expect(serialized).not.toContain("client-secret");
    expect(redacted).toMatchObject({
      clockifyApiKey: "[redacted]",
      accessToken: "[redacted]",
      idToken: "[redacted]",
      codeVerifier: "[redacted]",
      clientSecret: "[redacted]",
      nested: {
        clockifyApiKey: "[redacted]",
        accessToken: "[redacted]",
        idToken: "[redacted]",
        codeVerifier: "[redacted]",
        clientSecret: "[redacted]"
      },
      error: {
        clockifyApiKey: "[redacted]",
        accessToken: "[redacted]",
        idToken: "[redacted]",
        codeVerifier: "[redacted]",
        clientSecret: "[redacted]",
        nested: {
          clockifyApiKey: "[redacted]",
          accessToken: "[redacted]",
          idToken: "[redacted]",
          codeVerifier: "[redacted]",
          clientSecret: "[redacted]"
        }
      }
    });
  });

  test("removes camelCase secret aliases from query and log strings", () => {
    const redacted = redactSecrets(
      "GET /callback?accessToken=access-value&refreshToken=refresh-value&idToken=id-value&clockifyApiKey=clockify-value&codeVerifier=verifier-value&clientSecret=secret-value&x-api-key=x-api-key-value&api_key=api-key-value&apiKey=api-camel-value&code=oauth-code-value&state=oauth-state-value"
    );

    expect(redacted).toBe(
      "GET /callback?accessToken=[redacted]&refreshToken=[redacted]&idToken=[redacted]&clockifyApiKey=[redacted]&codeVerifier=[redacted]&clientSecret=[redacted]&x-api-key=[redacted]&api_key=[redacted]&apiKey=[redacted]&code=[redacted]&state=[redacted]"
    );
  });
});
