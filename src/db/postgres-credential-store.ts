import { nanoid } from "nanoid";

import { AuthorizationError } from "../auth/authorization.js";
import type { CredentialCipher } from "../auth/crypto.js";
import type { CredentialStore, StoredCredentialRecord } from "./credential-store.js";
import type { Queryable, TransactionClient, TransactionalQueryable } from "./postgres.js";

type CredentialRow = {
  id: string;
  owner_id: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_version: string;
  fingerprint: string;
  created_at: Date | string;
  updated_at: Date | string;
  revoked_at: Date | string | null;
};

export type PostgresCredentialStoreConfig = {
  queryable: Queryable;
  cipher: CredentialCipher;
};

const CREDENTIAL_COLUMNS = `
  id,
  owner_id,
  ciphertext,
  iv,
  auth_tag,
  key_version,
  fingerprint,
  created_at,
  updated_at,
  revoked_at
`;

export class PostgresCredentialStore implements CredentialStore {
  private readonly queryable: Queryable;
  private readonly cipher: CredentialCipher;

  constructor(config: PostgresCredentialStoreConfig) {
    this.queryable = config.queryable;
    this.cipher = config.cipher;
  }

  async save(input: { ownerId: string; plaintext: string; now?: Date }): Promise<StoredCredentialRecord> {
    const now = input.now ?? new Date();
    const encrypted = this.cipher.encryptCredential({ ...input, now });

    return withTransaction(this.queryable, async (client) => {
      await client.query(
        `
          UPDATE clockify_credentials
          SET revoked_at = $2, updated_at = $2
          WHERE owner_id = $1 AND revoked_at IS NULL
        `,
        [input.ownerId, now]
      );

      const result = await client.query<CredentialRow>(
        `
          INSERT INTO clockify_credentials (
            id,
            owner_id,
            ciphertext,
            iv,
            auth_tag,
            key_version,
            fingerprint,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING ${CREDENTIAL_COLUMNS}
        `,
        [
          nanoid(),
          encrypted.ownerId,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          encrypted.keyVersion,
          encrypted.fingerprint,
          new Date(encrypted.createdAt),
          new Date(encrypted.updatedAt)
        ]
      );

      return mapCredentialRow(result.rows[0]);
    });
  }

  async getActive(input: { ownerId: string; credentialId: string }): Promise<StoredCredentialRecord | undefined> {
    const result = await this.queryable.query<CredentialRow>(
      `
        SELECT ${CREDENTIAL_COLUMNS}
        FROM clockify_credentials
        WHERE owner_id = $1 AND id = $2 AND revoked_at IS NULL
        LIMIT 1
      `,
      [input.ownerId, input.credentialId]
    );

    return mapOptionalCredentialRow(result.rows[0]);
  }

  async getActiveByOwnerId(input: { ownerId: string }): Promise<StoredCredentialRecord | undefined> {
    const result = await this.queryable.query<CredentialRow>(
      `
        SELECT ${CREDENTIAL_COLUMNS}
        FROM clockify_credentials
        WHERE owner_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [input.ownerId]
    );

    return mapOptionalCredentialRow(result.rows[0]);
  }

  async decryptActive(input: { ownerId: string; credentialId: string }): Promise<string> {
    const record = await this.getActive(input);
    if (!record) {
      throw new AuthorizationError("Credential is unavailable");
    }
    return this.cipher.decryptCredential(record);
  }

  async decryptActiveByOwnerId(input: { ownerId: string }): Promise<string> {
    const record = await this.getActiveByOwnerId(input);
    if (!record) {
      throw new AuthorizationError("Credential is unavailable");
    }
    return this.cipher.decryptCredential(record);
  }

  async revoke(input: {
    ownerId: string;
    credentialId: string;
    now?: Date;
  }): Promise<StoredCredentialRecord | undefined> {
    const revokedAt = input.now ?? new Date();
    const result = await this.queryable.query<CredentialRow>(
      `
        UPDATE clockify_credentials
        SET revoked_at = $3, updated_at = $3
        WHERE id = $1 AND owner_id = $2
        RETURNING ${CREDENTIAL_COLUMNS}
      `,
      [input.credentialId, input.ownerId, revokedAt]
    );

    return mapOptionalCredentialRow(result.rows[0]);
  }

  async revokeActiveByOwnerId(input: { ownerId: string; now?: Date }): Promise<StoredCredentialRecord | undefined> {
    const revokedAt = input.now ?? new Date();
    const result = await this.queryable.query<CredentialRow>(
      `
        UPDATE clockify_credentials
        SET revoked_at = $2, updated_at = $2
        WHERE owner_id = $1 AND revoked_at IS NULL
        RETURNING ${CREDENTIAL_COLUMNS}
      `,
      [input.ownerId, revokedAt]
    );

    return mapOptionalCredentialRow(result.rows[0]);
  }

  async deleteByOwnerId(input: { ownerId: string }): Promise<number> {
    const result = await this.queryable.query(
      `
        DELETE FROM clockify_credentials
        WHERE owner_id = $1
      `,
      [input.ownerId]
    );

    return result.rowCount ?? 0;
  }

  async list(input: { ownerId: string }): Promise<StoredCredentialRecord[]> {
    const result = await this.queryable.query<CredentialRow>(
      `
        SELECT ${CREDENTIAL_COLUMNS}
        FROM clockify_credentials
        WHERE owner_id = $1
        ORDER BY created_at DESC
      `,
      [input.ownerId]
    );

    return result.rows.map(mapCredentialRow);
  }
}

async function withTransaction<T>(
  queryable: Queryable,
  work: (client: Queryable) => Promise<T>
): Promise<T> {
  if (!isTransactionalQueryable(queryable)) {
    throw new Error("PostgresCredentialStore.save requires a transaction-capable queryable.");
  }
  const client = await queryable.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

function isTransactionalQueryable(queryable: Queryable): queryable is TransactionalQueryable {
  return typeof (queryable as { connect?: unknown }).connect === "function";
}

async function rollbackQuietly(client: TransactionClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original transaction error.
  }
}

function mapOptionalCredentialRow(row: CredentialRow | undefined): StoredCredentialRecord | undefined {
  return row ? mapCredentialRow(row) : undefined;
}

function mapCredentialRow(row: CredentialRow): StoredCredentialRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.auth_tag,
    keyVersion: row.key_version,
    fingerprint: row.fingerprint,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    revokedAt: row.revoked_at ? toIsoString(row.revoked_at) : undefined
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
