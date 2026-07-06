import { createCredentialCipher } from "../auth/crypto.js";
import { createOAuthService } from "../auth/oauth.js";
import { ClockifyClient } from "../clockify/client.js";
import { createPgPoolFromEnv } from "../db/postgres.js";
import { PostgresCredentialStore } from "../db/postgres-credential-store.js";
import { PostgresOAuthStore } from "../db/postgres-oauth-store.js";
import type { AppOptions } from "./app.js";

export type RuntimeEnv = Partial<NodeJS.ProcessEnv>;

const allowedOAuthScopes = ["clockify.read", "clockify.time.write", "clockify.time.delete"];
const requiredDatabaseSchema = {
  clockify_credentials: [
    "id",
    "owner_id",
    "ciphertext",
    "iv",
    "auth_tag",
    "key_version",
    "fingerprint",
    "created_at",
    "updated_at",
    "revoked_at"
  ],
  oauth_authorization_codes: [
    "code",
    "owner_id",
    "client_id",
    "resource",
    "redirect_uri",
    "scopes",
    "code_challenge",
    "code_challenge_method",
    "expires_at",
    "consumed_at",
    "created_at"
  ],
  oauth_token_revocations: ["token_id", "owner_id", "client_id", "revoked_at", "expires_at"]
} as const;
const requiredDatabaseTables = Object.keys(requiredDatabaseSchema);

export function createRuntimeOptions(env: RuntimeEnv = process.env): AppOptions {
  assertRequiredEnv(env, [
    "PUBLIC_BASE_URL",
    "DATABASE_URL",
    "CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY",
    "CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION",
    "OAUTH_JWT_SECRET",
    "OAUTH_ALLOWED_REDIRECT_URIS"
  ]);
  const publicBaseUrl = validatePublicBaseUrl(env.PUBLIC_BASE_URL, env.NODE_ENV);
  const jwtSecret = env.OAUTH_JWT_SECRET;
  validateJwtSecret(jwtSecret);
  const allowedRedirectUris = parseAllowedRedirectUris(env.OAUTH_ALLOWED_REDIRECT_URIS);
  const tokenTtlSeconds = positiveIntegerEnv(env.OAUTH_TOKEN_TTL_SECONDS, 3600, "OAUTH_TOKEN_TTL_SECONDS");
  validatePgSslMode(env.PGSSLMODE);
  const pool = createPgPoolFromEnv({
    DATABASE_URL: env.DATABASE_URL,
    PGSSLMODE: env.PGSSLMODE
  });
  const cipher = createCredentialCipher({
    activeKeyVersion: env.CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION,
    keys: {
      [env.CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION]: env.CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY
    }
  });
  const credentialStore = new PostgresCredentialStore({ queryable: pool, cipher });
  const oauthStore = new PostgresOAuthStore({ queryable: pool });

  return {
    publicBaseUrl,
    trustProxy: positiveIntegerEnv(env.TRUST_PROXY_HOPS, 1, "TRUST_PROXY_HOPS"),
    jwtSecret,
    credentialStore,
    tokenRevocationStore: oauthStore,
    oauthService: createOAuthService({
      issuer: publicBaseUrl,
      resource: `${publicBaseUrl}/mcp`,
      jwtSecret,
      allowedRedirectUris,
      allowedScopes: allowedOAuthScopes,
      authorizationCodeStore: oauthStore,
      tokenTtlSeconds
    }),
    healthCheck: async () => {
      await pool.query("SELECT 1");
      await assertRequiredDatabaseTables(pool);
    },
    sensitiveRouteRateLimit: {
      max: positiveIntegerEnv(env.SENSITIVE_ROUTE_RATE_LIMIT_MAX, 20, "SENSITIVE_ROUTE_RATE_LIMIT_MAX"),
      windowMs: positiveIntegerEnv(
        env.SENSITIVE_ROUTE_RATE_LIMIT_WINDOW_MS,
        60_000,
        "SENSITIVE_ROUTE_RATE_LIMIT_WINDOW_MS"
      )
    },
    createClient: (apiKey: string) => new ClockifyClient({ apiKey })
  };
}

type RequiredRuntimeEnvName =
  | "PUBLIC_BASE_URL"
  | "DATABASE_URL"
  | "CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY"
  | "CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION"
  | "OAUTH_JWT_SECRET"
  | "OAUTH_ALLOWED_REDIRECT_URIS";

function assertRequiredEnv(
  env: RuntimeEnv,
  names: RequiredRuntimeEnvName[]
): asserts env is RuntimeEnv & Record<RequiredRuntimeEnvName, string> {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function validateJwtSecret(secret: string): void {
  if (secret.trim().length === 0) {
    throw new Error("OAUTH_JWT_SECRET must contain non-whitespace characters.");
  }
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("OAUTH_JWT_SECRET must be at least 32 bytes.");
  }
}

function validatePublicBaseUrl(value: string, nodeEnv: string | undefined): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:" && !isAllowedLocalHttpBaseUrl(parsed, nodeEnv)) {
    throw new Error("PUBLIC_BASE_URL must use https.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function isAllowedLocalHttpBaseUrl(parsed: URL, nodeEnv: string | undefined): boolean {
  if (nodeEnv === "production" || parsed.protocol !== "http:") return false;
  return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
}

function parseAllowedRedirectUris(value: string): string[] {
  const uris = value
    .split(",")
    .map((uri) => uri.trim())
    .filter(Boolean);
  if (uris.length === 0) {
    throw new Error("OAUTH_ALLOWED_REDIRECT_URIS must include at least one redirect URI.");
  }
  for (const uri of uris) {
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== "https:") {
        throw new Error("not https");
      }
      if (parsed.hash) {
        throw new Error("fragment");
      }
    } catch {
      throw new Error("OAUTH_ALLOWED_REDIRECT_URIS must contain only valid URL values without fragments.");
    }
  }
  return uris;
}

function validatePgSslMode(value: string | undefined): void {
  if (value === undefined || value.length === 0 || value === "require" || value === "verify-full") {
    return;
  }
  throw new Error("PGSSLMODE must be unset, require, or verify-full.");
}

async function assertRequiredDatabaseTables(queryable: {
  query<T = unknown>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}): Promise<void> {
  const result = await queryable.query<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [requiredDatabaseTables]
  );
  const existingTables = new Set(result.rows.map((row) => row.table_name));
  const missingTables = requiredDatabaseTables.filter((table) => !existingTables.has(table));
  if (missingTables.length > 0) {
    throw new Error(`Missing required database tables: ${missingTables.join(", ")}`);
  }

  const columnResult = await queryable.query<{ table_name: string; column_name: string }>(
    `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [requiredDatabaseTables]
  );
  const columnsByTable = new Map<string, Set<string>>();
  for (const row of columnResult.rows) {
    const columns = columnsByTable.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }
  const missingColumns = Object.entries(requiredDatabaseSchema).flatMap(([tableName, columnNames]) => {
    const existingColumns = columnsByTable.get(tableName) ?? new Set<string>();
    return columnNames.filter((columnName) => !existingColumns.has(columnName)).map((columnName) => `${tableName}.${columnName}`);
  });
  if (missingColumns.length > 0) {
    throw new Error(`Missing required database columns: ${missingColumns.join(", ")}`);
  }
}

function positiveIntegerEnv(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}
