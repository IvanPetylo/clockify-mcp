import type { AuthorizationCodeStore, StoredAuthorizationCode } from "../auth/oauth.js";
import type { TokenRevocationStore } from "../auth/jwt.js";
import type { Queryable } from "./postgres.js";

export type PostgresOAuthStoreConfig = {
  queryable: Queryable;
};

type TokenRevocationRow = {
  token_id: string;
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

export class PostgresOAuthStore implements TokenRevocationStore, AuthorizationCodeStore {
  private readonly queryable: Queryable;

  constructor(config: PostgresOAuthStoreConfig) {
    this.queryable = config.queryable;
  }

  async isRevoked(tokenId: string): Promise<boolean> {
    const result = await this.queryable.query<TokenRevocationRow>(
      `
        SELECT token_id
        FROM oauth_token_revocations
        WHERE token_id = $1
          AND (expires_at IS NULL OR expires_at > now())
        LIMIT 1
      `,
      [tokenId]
    );

    return result.rows.length > 0;
  }

  async saveAuthorizationCode(record: StoredAuthorizationCode): Promise<void> {
    await this.deleteExpiredAuthorizationCodes({ now: record.createdAt });
    await this.queryable.query(
      `
        INSERT INTO oauth_authorization_codes (
          code,
          owner_id,
          client_id,
          resource,
          redirect_uri,
          scopes,
          code_challenge,
          code_challenge_method,
          expires_at,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        record.code,
        record.subject,
        record.clientId,
        record.resource,
        record.redirectUri,
        record.scope.split(" ").filter(Boolean),
        record.codeChallenge,
        record.codeChallengeMethod,
        record.expiresAt,
        record.createdAt
      ]
    );
  }

  async deleteExpiredAuthorizationCodes(input: { now?: Date } = {}): Promise<number> {
    const now = input.now ?? new Date();
    const result = await this.queryable.query(
      `
        DELETE FROM oauth_authorization_codes
        WHERE expires_at <= $1
      `,
      [now]
    );
    return result.rowCount ?? 0;
  }

  async getAuthorizationCode(input: { code: string; now?: Date }): Promise<StoredAuthorizationCode | undefined> {
    const now = input.now ?? new Date();
    const result = await this.queryable.query<AuthorizationCodeRow>(
      `
        SELECT
          code,
          owner_id,
          client_id,
          resource,
          redirect_uri,
          scopes,
          code_challenge,
          code_challenge_method,
          expires_at,
          consumed_at,
          created_at
        FROM oauth_authorization_codes
        WHERE code = $1
          AND consumed_at IS NULL
          AND expires_at > $2
        LIMIT 1
      `,
      [input.code, now]
    );
    const row = result.rows[0];
    return row ? authorizationCodeFromRow(row) : undefined;
  }

  async consumeAuthorizationCode(input: { code: string; now?: Date }): Promise<StoredAuthorizationCode | undefined> {
    const consumedAt = input.now ?? new Date();
    const result = await this.queryable.query<AuthorizationCodeRow>(
      `
        UPDATE oauth_authorization_codes
        SET consumed_at = $1
        WHERE code = $2
          AND consumed_at IS NULL
          AND expires_at > $1
        RETURNING
          code,
          owner_id,
          client_id,
          resource,
          redirect_uri,
          scopes,
          code_challenge,
          code_challenge_method,
          expires_at,
          consumed_at,
          created_at
      `,
      [consumedAt, input.code]
    );
    const row = result.rows[0];
    return row ? authorizationCodeFromRow(row) : undefined;
  }

  async revoke(input: {
    tokenId: string;
    ownerId: string;
    clientId?: string;
    expiresAt?: Date;
    now?: Date;
  }): Promise<void> {
    const revokedAt = input.now ?? new Date();

    await this.queryable.query(
      `
        INSERT INTO oauth_token_revocations (
          token_id,
          owner_id,
          client_id,
          revoked_at,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (token_id) DO UPDATE
        SET
          owner_id = EXCLUDED.owner_id,
          client_id = EXCLUDED.client_id,
          revoked_at = EXCLUDED.revoked_at,
          expires_at = EXCLUDED.expires_at
      `,
      [input.tokenId, input.ownerId, input.clientId ?? null, revokedAt, input.expiresAt ?? null]
    );
  }
}

function authorizationCodeFromRow(row: AuthorizationCodeRow): StoredAuthorizationCode {
  return {
    code: row.code,
    subject: row.owner_id,
    clientId: row.client_id,
    resource: row.resource,
    redirectUri: row.redirect_uri,
    scope: row.scopes.join(" "),
    codeChallenge: row.code_challenge ?? "",
    codeChallengeMethod: row.code_challenge_method ?? "",
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    consumedAt: row.consumed_at ?? undefined
  };
}
