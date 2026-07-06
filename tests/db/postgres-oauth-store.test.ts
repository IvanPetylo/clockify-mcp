import { PostgresOAuthStore } from "../../src/db/postgres-oauth-store.js";
import type { Queryable, QueryResult } from "../../src/db/postgres.js";

type TokenRevocationRow = {
  token_id: string;
  owner_id: string;
  client_id: string | null;
  revoked_at: Date;
  expires_at: Date | null;
};

type AuthorizationCodeRow = {
  code: string;
  owner_id: string;
  client_id: string;
  resource: string;
  redirect_uri: string;
  scopes: string[];
  code_challenge: string | null;
  code_challenge_method: string | null;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
};

class FakeOAuthQueryable implements Queryable {
  readonly revocations: TokenRevocationRow[] = [];
  readonly authorizationCodes: AuthorizationCodeRow[] = [];

  async query<T = unknown>(sql: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    const normalizedSql = sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalizedSql.startsWith("insert into oauth_authorization_codes")) {
      const [
        code,
        ownerId,
        clientId,
        resource,
        redirectUri,
        scopes,
        codeChallenge,
        codeChallengeMethod,
        expiresAt,
        createdAt
      ] = values as [string, string, string, string, string, string[], string, string, Date, Date];
      this.authorizationCodes.push({
        code,
        owner_id: ownerId,
        client_id: clientId,
        resource,
        redirect_uri: redirectUri,
        scopes,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        expires_at: expiresAt,
        consumed_at: null,
        created_at: createdAt
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalizedSql.startsWith("delete from oauth_authorization_codes")) {
      const [now] = values as [Date];
      const before = this.authorizationCodes.length;
      for (let index = this.authorizationCodes.length - 1; index >= 0; index -= 1) {
        if (this.authorizationCodes[index].expires_at <= now) {
          this.authorizationCodes.splice(index, 1);
        }
      }
      return { rows: [], rowCount: before - this.authorizationCodes.length };
    }

    if (normalizedSql.startsWith("update oauth_authorization_codes")) {
      const [consumedAt, code] = values as [Date, string];
      const row = this.authorizationCodes.find((candidate) => candidate.code === code);
      if (!row || row.consumed_at || row.expires_at <= consumedAt) {
        return { rows: [], rowCount: 0 };
      }
      row.consumed_at = consumedAt;
      return { rows: [row] as T[], rowCount: 1 };
    }

    if (normalizedSql.startsWith("select") && normalizedSql.includes("oauth_authorization_codes")) {
      const [code, now] = values as [string, Date];
      const row = this.authorizationCodes.find((candidate) => candidate.code === code);
      if (!row || row.consumed_at || row.expires_at <= now) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [row] as T[], rowCount: 1 };
    }

    if (normalizedSql.startsWith("insert into oauth_token_revocations")) {
      const [tokenId, ownerId, clientId, revokedAt, expiresAt] = values as [
        string,
        string,
        string | undefined,
        Date,
        Date | undefined
      ];
      const existing = this.revocations.find((row) => row.token_id === tokenId);
      if (existing) {
        existing.owner_id = ownerId;
        existing.client_id = clientId ?? null;
        existing.revoked_at = revokedAt;
        existing.expires_at = expiresAt ?? null;
        return { rows: [], rowCount: 1 };
      }

      this.revocations.push({
        token_id: tokenId,
        owner_id: ownerId,
        client_id: clientId ?? null,
        revoked_at: revokedAt,
        expires_at: expiresAt ?? null
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalizedSql.startsWith("select") && normalizedSql.includes("oauth_token_revocations")) {
      const [tokenId] = values as [string];
      const row = this.revocations.find((candidate) => candidate.token_id === tokenId);
      if (!row) {
        return { rows: [], rowCount: 0 };
      }
      const honorsExpiration = normalizedSql.includes("expires_at is null or expires_at > now()");
      if (honorsExpiration && row.expires_at && row.expires_at <= new Date()) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [row] as T[], rowCount: 1 };
    }

    throw new Error(`Unhandled fake query: ${sql}`);
  }
}

describe("PostgresOAuthStore", () => {
  test("revoke inserts token revocation details", async () => {
    const queryable = new FakeOAuthQueryable();
    const store = new PostgresOAuthStore({ queryable });
    const revokedAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-01-01T00:05:00.000Z");

    await store.revoke({
      tokenId: "token-123",
      ownerId: "owner-1",
      clientId: "chatgpt",
      expiresAt,
      now: revokedAt
    });

    expect(queryable.revocations).toEqual([
      {
        token_id: "token-123",
        owner_id: "owner-1",
        client_id: "chatgpt",
        revoked_at: revokedAt,
        expires_at: expiresAt
      }
    ]);
  });

  test("isRevoked returns true only for inserted token ids", async () => {
    const queryable = new FakeOAuthQueryable();
    const store = new PostgresOAuthStore({ queryable });

    await store.revoke({ tokenId: "token-123", ownerId: "owner-1" });

    await expect(store.isRevoked("token-123")).resolves.toBe(true);
    await expect(store.isRevoked("other-token")).resolves.toBe(false);
  });

  test("isRevoked ignores expired token revocation rows", async () => {
    const queryable = new FakeOAuthQueryable();
    const store = new PostgresOAuthStore({ queryable });

    await store.revoke({
      tokenId: "token-123",
      ownerId: "owner-1",
      expiresAt: new Date(Date.now() - 1000)
    });

    await expect(store.isRevoked("token-123")).resolves.toBe(false);
  });

  test("saves and consumes authorization codes exactly once", async () => {
    const queryable = new FakeOAuthQueryable();
    const store = new PostgresOAuthStore({ queryable });
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-01-01T00:05:00.000Z");
    const consumedAt = new Date("2026-01-01T00:01:00.000Z");

    await store.saveAuthorizationCode({
      code: "code-123",
      subject: "owner-1",
      clientId: "chatgpt",
      resource: "https://clockify-mcp.example.com/mcp",
      redirectUri: "https://chat.openai.com/aip/callback",
      scope: "clockify.read clockify.time.write",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      expiresAt,
      createdAt
    });

    await expect(store.getAuthorizationCode({ code: "code-123", now: consumedAt })).resolves.toMatchObject({
      code: "code-123",
      subject: "owner-1",
      clientId: "chatgpt",
      resource: "https://clockify-mcp.example.com/mcp",
      redirectUri: "https://chat.openai.com/aip/callback",
      scope: "clockify.read clockify.time.write",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256"
    });
    await expect(store.consumeAuthorizationCode({ code: "code-123", now: consumedAt })).resolves.toMatchObject({
      code: "code-123",
      subject: "owner-1",
      clientId: "chatgpt",
      resource: "https://clockify-mcp.example.com/mcp",
      redirectUri: "https://chat.openai.com/aip/callback",
      scope: "clockify.read clockify.time.write",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256"
    });
    await expect(store.consumeAuthorizationCode({ code: "code-123", now: consumedAt })).resolves.toBeUndefined();
  });

  test("deletes expired authorization codes", async () => {
    const queryable = new FakeOAuthQueryable();
    const store = new PostgresOAuthStore({ queryable });
    const now = new Date("2026-01-01T00:10:00.000Z");
    queryable.authorizationCodes.push(
      {
        code: "expired-code",
        owner_id: "owner-1",
        client_id: "chatgpt",
        resource: "https://clockify-mcp.example.com/mcp",
        redirect_uri: "https://chat.openai.com/aip/callback",
        scopes: ["clockify.read"],
        code_challenge: "challenge",
        code_challenge_method: "S256",
        expires_at: new Date("2026-01-01T00:09:59.000Z"),
        consumed_at: null,
        created_at: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        code: "active-code",
        owner_id: "owner-1",
        client_id: "chatgpt",
        resource: "https://clockify-mcp.example.com/mcp",
        redirect_uri: "https://chat.openai.com/aip/callback",
        scopes: ["clockify.read"],
        code_challenge: "challenge",
        code_challenge_method: "S256",
        expires_at: new Date("2026-01-01T00:10:01.000Z"),
        consumed_at: null,
        created_at: new Date("2026-01-01T00:00:00.000Z")
      }
    );

    await expect(store.deleteExpiredAuthorizationCodes({ now })).resolves.toBe(1);

    expect(queryable.authorizationCodes.map((row) => row.code)).toEqual(["active-code"]);
  });

  test("deletes expired authorization codes before saving a new code", async () => {
    const queryable = new FakeOAuthQueryable();
    const store = new PostgresOAuthStore({ queryable });
    const createdAt = new Date("2026-01-01T00:10:00.000Z");
    queryable.authorizationCodes.push({
      code: "expired-code",
      owner_id: "owner-1",
      client_id: "chatgpt",
      resource: "https://clockify-mcp.example.com/mcp",
      redirect_uri: "https://chat.openai.com/aip/callback",
      scopes: ["clockify.read"],
      code_challenge: "challenge",
      code_challenge_method: "S256",
      expires_at: new Date("2026-01-01T00:09:59.000Z"),
      consumed_at: null,
      created_at: new Date("2026-01-01T00:00:00.000Z")
    });

    await store.saveAuthorizationCode({
      code: "new-code",
      subject: "owner-1",
      clientId: "chatgpt",
      resource: "https://clockify-mcp.example.com/mcp",
      redirectUri: "https://chat.openai.com/aip/callback",
      scope: "clockify.read",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      expiresAt: new Date("2026-01-01T00:15:00.000Z"),
      createdAt
    });

    expect(queryable.authorizationCodes.map((row) => row.code)).toEqual(["new-code"]);
  });
});
