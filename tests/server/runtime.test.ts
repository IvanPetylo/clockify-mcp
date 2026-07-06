import { createRuntimeOptions } from "../../src/server/runtime.js";
import { createPgPoolFromEnv } from "../../src/db/postgres.js";
import type { QueryResult } from "../../src/db/postgres.js";

const mocks = vi.hoisted(() => ({
  query: vi.fn(async (_sql: string, _values?: readonly unknown[]): Promise<QueryResult> => ({ rows: [], rowCount: 1 }))
}));

vi.mock("../../src/db/postgres.js", () => ({
  createPgPoolFromEnv: vi.fn(() => ({ query: mocks.query }))
}));

describe("server runtime wiring", () => {
  beforeEach(() => {
    vi.mocked(createPgPoolFromEnv).mockClear();
    mocks.query.mockReset();
    mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  test("creates app options from production environment", () => {
    const options = createRuntimeOptions({
      PUBLIC_BASE_URL: "https://clockify-mcp.example.com",
      DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
      OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!",
      OAUTH_ALLOWED_REDIRECT_URIS: "https://chat.openai.com/aip/callback,https://chatgpt.com/aip/callback"
    });

    expect(options.publicBaseUrl).toBe("https://clockify-mcp.example.com");
    expect(options.jwtSecret).toBe("test-secret-with-at-least-32-bytes!");
    expect(options.credentialStore).toBeDefined();
    expect(options.tokenRevocationStore).toBeDefined();
    expect(options.oauthService).toBeDefined();
    expect(options.createClient).toEqual(expect.any(Function));
    expect(options.healthCheck).toEqual(expect.any(Function));
    expect(options.sensitiveRouteRateLimit).toEqual({
      max: 20,
      windowMs: 60_000
    });
    expect(options.trustProxy).toBe(1);
  });

  test("reads sensitive route rate-limit configuration from environment", () => {
    const options = createRuntimeOptions({
      PUBLIC_BASE_URL: "https://clockify-mcp.example.com",
      DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
      OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!",
      OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id",
      SENSITIVE_ROUTE_RATE_LIMIT_MAX: "5",
      SENSITIVE_ROUTE_RATE_LIMIT_WINDOW_MS: "30000"
    });

    expect(options.sensitiveRouteRateLimit).toEqual({
      max: 5,
      windowMs: 30_000
    });
  });

  test("reads trusted proxy hop configuration from environment", () => {
    const options = createRuntimeOptions({
      PUBLIC_BASE_URL: "https://clockify-mcp.example.com",
      DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
      OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!",
      OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id",
      TRUST_PROXY_HOPS: "2"
    });

    expect(options.trustProxy).toBe(2);
  });

  test("checks Postgres readiness through the runtime pool", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.tables")) {
        return {
          rows: [
            { table_name: "clockify_credentials" },
            { table_name: "oauth_authorization_codes" },
            { table_name: "oauth_token_revocations" }
          ],
          rowCount: 3
        };
      }
      if (sql.includes("information_schema.columns")) {
        return {
          rows: [
            { table_name: "clockify_credentials", column_name: "id" },
            { table_name: "clockify_credentials", column_name: "owner_id" },
            { table_name: "clockify_credentials", column_name: "ciphertext" },
            { table_name: "clockify_credentials", column_name: "iv" },
            { table_name: "clockify_credentials", column_name: "auth_tag" },
            { table_name: "clockify_credentials", column_name: "key_version" },
            { table_name: "clockify_credentials", column_name: "fingerprint" },
            { table_name: "clockify_credentials", column_name: "created_at" },
            { table_name: "clockify_credentials", column_name: "updated_at" },
            { table_name: "clockify_credentials", column_name: "revoked_at" },
            { table_name: "oauth_authorization_codes", column_name: "code" },
            { table_name: "oauth_authorization_codes", column_name: "owner_id" },
            { table_name: "oauth_authorization_codes", column_name: "client_id" },
            { table_name: "oauth_authorization_codes", column_name: "resource" },
            { table_name: "oauth_authorization_codes", column_name: "redirect_uri" },
            { table_name: "oauth_authorization_codes", column_name: "scopes" },
            { table_name: "oauth_authorization_codes", column_name: "code_challenge" },
            { table_name: "oauth_authorization_codes", column_name: "code_challenge_method" },
            { table_name: "oauth_authorization_codes", column_name: "expires_at" },
            { table_name: "oauth_authorization_codes", column_name: "consumed_at" },
            { table_name: "oauth_authorization_codes", column_name: "created_at" },
            { table_name: "oauth_token_revocations", column_name: "token_id" },
            { table_name: "oauth_token_revocations", column_name: "owner_id" },
            { table_name: "oauth_token_revocations", column_name: "client_id" },
            { table_name: "oauth_token_revocations", column_name: "revoked_at" },
            { table_name: "oauth_token_revocations", column_name: "expires_at" }
          ],
          rowCount: 26
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const options = createRuntimeOptions({
      PUBLIC_BASE_URL: "https://clockify-mcp.example.com/",
      DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
      PGSSLMODE: "require",
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
      OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!",
      OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id"
    });

    await options.healthCheck?.();

    expect(createPgPoolFromEnv).toHaveBeenCalledWith({
      DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
      PGSSLMODE: "require"
    });
    expect(mocks.query).toHaveBeenCalledWith("SELECT 1");
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("information_schema.tables"), [
      ["clockify_credentials", "oauth_authorization_codes", "oauth_token_revocations"]
    ]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("information_schema.columns"), [
      ["clockify_credentials", "oauth_authorization_codes", "oauth_token_revocations"]
    ]);
  });

  test("accepts verified Postgres TLS mode for production runtime", () => {
    createRuntimeOptions({
      PUBLIC_BASE_URL: "https://clockify-mcp.example.com",
      DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
      PGSSLMODE: "verify-full",
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
      OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!",
      OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id"
    });

    expect(createPgPoolFromEnv).toHaveBeenCalledWith({
      DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
      PGSSLMODE: "verify-full"
    });
  });

  test("Postgres readiness fails when required migration tables are missing", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.tables")) {
        return {
          rows: [{ table_name: "clockify_credentials" }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const options = createRuntimeOptions({
      PUBLIC_BASE_URL: "https://clockify-mcp.example.com/",
      DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
      OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!",
      OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id"
    });

    await expect(options.healthCheck?.()).rejects.toThrow(
      /Missing required database tables: oauth_authorization_codes, oauth_token_revocations/
    );
  });

  test("Postgres readiness fails when required migration columns are missing", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.tables")) {
        return {
          rows: [
            { table_name: "clockify_credentials" },
            { table_name: "oauth_authorization_codes" },
            { table_name: "oauth_token_revocations" }
          ],
          rowCount: 3
        };
      }
      if (sql.includes("information_schema.columns")) {
        return {
          rows: [
            { table_name: "clockify_credentials", column_name: "id" },
            { table_name: "oauth_authorization_codes", column_name: "code" },
            { table_name: "oauth_token_revocations", column_name: "token_id" }
          ],
          rowCount: 3
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const options = createRuntimeOptions({
      PUBLIC_BASE_URL: "https://clockify-mcp.example.com/",
      DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
      OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!",
      OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id"
    });

    await expect(options.healthCheck?.()).rejects.toThrow(/Missing required database columns: clockify_credentials.owner_id/);
  });

  test("rejects missing required production configuration with all missing names", () => {
    expect(() => createRuntimeOptions({ PUBLIC_BASE_URL: "https://clockify-mcp.example.com" })).toThrow(
      /DATABASE_URL.*CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY.*OAUTH_JWT_SECRET/s
    );
  });

  test("rejects whitespace-only required production configuration", () => {
    expect(() =>
      createRuntimeOptions({
        PUBLIC_BASE_URL: "   ",
        DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
        OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!",
        OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id"
      })
    ).toThrow(/PUBLIC_BASE_URL/);
  });

  test("rejects weak JWT signing secrets", () => {
    expect(() =>
      createRuntimeOptions({
        PUBLIC_BASE_URL: "https://clockify-mcp.example.com",
        DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
        OAUTH_JWT_SECRET: "short-secret",
        OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id"
      })
    ).toThrow(/OAUTH_JWT_SECRET.*32 bytes/);
  });

  test("rejects whitespace-only JWT signing secrets", () => {
    expect(() =>
      createRuntimeOptions({
        PUBLIC_BASE_URL: "https://clockify-mcp.example.com",
        DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
        OAUTH_JWT_SECRET: "                                ",
        OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id"
      })
    ).toThrow(/OAUTH_JWT_SECRET.*non-whitespace/);
  });

  test("rejects non-HTTPS public base URLs in production runtime", () => {
    expect(() =>
      createRuntimeOptions({
        PUBLIC_BASE_URL: "http://clockify-mcp.example.com",
        DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
        OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!",
        OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id"
      })
    ).toThrow(/PUBLIC_BASE_URL.*https/i);
  });

  test("allows loopback HTTP public base URLs for local development", () => {
    const options = createRuntimeOptions({
      NODE_ENV: "development",
      PUBLIC_BASE_URL: "http://localhost:3000",
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/clockify_mcp",
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
      OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!",
      OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id"
    });

    expect(options.publicBaseUrl).toBe("http://localhost:3000");
  });

  test("rejects loopback HTTP public base URLs in production", () => {
    expect(() =>
      createRuntimeOptions({
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "http://localhost:3000",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/clockify_mcp",
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
        OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!",
        OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id"
      })
    ).toThrow(/PUBLIC_BASE_URL.*https/i);
  });

  test("rejects empty or malformed OAuth redirect allow-list values", () => {
    const baseEnv = {
      PUBLIC_BASE_URL: "https://clockify-mcp.example.com",
      DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
      OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!"
    };

    expect(() =>
      createRuntimeOptions({
        ...baseEnv,
        OAUTH_ALLOWED_REDIRECT_URIS: " , "
      })
    ).toThrow(/OAUTH_ALLOWED_REDIRECT_URIS.*at least one/i);
    expect(() =>
      createRuntimeOptions({
        ...baseEnv,
        OAUTH_ALLOWED_REDIRECT_URIS: "not-a-url"
      })
    ).toThrow(/OAUTH_ALLOWED_REDIRECT_URIS.*valid URL/i);
    expect(() =>
      createRuntimeOptions({
        ...baseEnv,
        OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id#fragment"
      })
    ).toThrow(/OAUTH_ALLOWED_REDIRECT_URIS.*fragment/i);
  });

  test("rejects invalid OAuth token TTL configuration", () => {
    expect(() =>
      createRuntimeOptions({
        PUBLIC_BASE_URL: "https://clockify-mcp.example.com",
        DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
        OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!",
        OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id",
        OAUTH_TOKEN_TTL_SECONDS: "0"
      })
    ).toThrow(/OAUTH_TOKEN_TTL_SECONDS.*positive integer/);
  });

  test("rejects unsupported Postgres SSL mode values", () => {
    expect(() =>
      createRuntimeOptions({
        PUBLIC_BASE_URL: "https://clockify-mcp.example.com",
        DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
        PGSSLMODE: "typo",
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
        CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION: "v1",
        OAUTH_JWT_SECRET: "test-secret-with-at-least-32-bytes!",
        OAUTH_ALLOWED_REDIRECT_URIS: "https://chatgpt.com/connector/oauth/callback_id"
      })
    ).toThrow(/PGSSLMODE.*require|verify-full/);
  });
});
