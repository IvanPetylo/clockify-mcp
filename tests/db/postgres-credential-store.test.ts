import { randomBytes } from "node:crypto";

import { AuthorizationError } from "../../src/auth/authorization.js";
import { createCredentialCipher } from "../../src/auth/crypto.js";
import { PostgresCredentialStore } from "../../src/db/postgres-credential-store.js";
import type { Queryable, QueryResult, TransactionClient } from "../../src/db/postgres.js";

type CredentialRow = {
  id: string;
  owner_id: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_version: string;
  fingerprint: string;
  created_at: Date;
  updated_at: Date;
  revoked_at: Date | null;
};

function key(): string {
  return randomBytes(32).toString("base64");
}

class FakeCredentialQueryable implements Queryable {
  readonly rows: CredentialRow[] = [];
  readonly operations: string[] = [];
  failNextInsert = false;

  async query<T = unknown>(sql: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    return this.queryRows(this.rows, sql, values);
  }

  async connect(): Promise<TransactionClient> {
    this.operations.push("connect");
    const transactionRows = this.rows.map(cloneCredentialRow);
    let finished = false;

    return {
      query: async <T = unknown>(sql: string, values: readonly unknown[] = []) => {
        const normalizedSql = sql.replace(/\s+/g, " ").trim().toLowerCase();
        if (normalizedSql === "begin") {
          this.operations.push("begin");
          return { rows: [], rowCount: null };
        }
        if (normalizedSql === "commit") {
          this.operations.push("commit");
          finished = true;
          this.rows.splice(0, this.rows.length, ...transactionRows.map(cloneCredentialRow));
          return { rows: [], rowCount: null };
        }
        if (normalizedSql === "rollback") {
          this.operations.push("rollback");
          finished = true;
          return { rows: [], rowCount: null };
        }
        if (finished) {
          throw new Error("Transaction already finished");
        }
        return this.queryRows<T>(transactionRows, sql, values);
      },
      release: () => {
        this.operations.push("release");
      }
    };
  }

  private async queryRows<T = unknown>(
    rows: CredentialRow[],
    sql: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<T>> {
    const normalizedSql = sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalizedSql.startsWith("update clockify_credentials") && normalizedSql.includes("owner_id = $1")) {
      this.operations.push("update-active");
      const [ownerId, revokedAt] = values as [string, Date];
      const updatedRows = rows
        .filter((row) => row.owner_id === ownerId && row.revoked_at === null)
        .map((row) => {
          row.revoked_at = revokedAt;
          row.updated_at = revokedAt;
          return row;
        });
      return { rows: updatedRows as T[], rowCount: updatedRows.length };
    }

    if (normalizedSql.startsWith("update clockify_credentials") && normalizedSql.includes("id = $1")) {
      const [credentialId, ownerId, revokedAt] = values as [string, string, Date];
      const row = this.rows.find((candidate) => candidate.id === credentialId && candidate.owner_id === ownerId);
      if (!row) {
        return { rows: [], rowCount: 0 };
      }
      row.revoked_at = revokedAt;
      row.updated_at = revokedAt;
      return { rows: [row as T], rowCount: 1 };
    }

    if (normalizedSql.startsWith("insert into clockify_credentials")) {
      this.operations.push("insert");
      if (this.failNextInsert) {
        this.failNextInsert = false;
        throw new Error("insert failed");
      }
      const [id, ownerId, ciphertext, iv, authTag, keyVersion, fingerprint, createdAt, updatedAt] = values as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        Date,
        Date
      ];
      const row = {
        id,
        owner_id: ownerId,
        ciphertext,
        iv,
        auth_tag: authTag,
        key_version: keyVersion,
        fingerprint,
        created_at: createdAt,
        updated_at: updatedAt,
        revoked_at: null
      };
      rows.push(row);
      return { rows: [row as T], rowCount: 1 };
    }

    if (normalizedSql.startsWith("delete from clockify_credentials")) {
      const [ownerId] = values as [string];
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rows[index].owner_id === ownerId) {
          rows.splice(index, 1);
        }
      }
      return { rows: [], rowCount: before - rows.length };
    }

    if (normalizedSql.startsWith("select") && normalizedSql.includes("id = $2")) {
      const [ownerId, credentialId] = values as [string, string];
      const row = rows.find(
        (candidate) => candidate.owner_id === ownerId && candidate.id === credentialId && candidate.revoked_at === null
      );
      return { rows: row ? [row as T] : [], rowCount: row ? 1 : 0 };
    }

    if (normalizedSql.startsWith("select") && normalizedSql.includes("revoked_at is null")) {
      const [ownerId] = values as [string];
      const row = rows
        .filter((candidate) => candidate.owner_id === ownerId && candidate.revoked_at === null)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
      return { rows: row ? [row as T] : [], rowCount: row ? 1 : 0 };
    }

    if (normalizedSql.startsWith("select")) {
      const [ownerId] = values as [string];
      const selectedRows = rows
        .filter((candidate) => candidate.owner_id === ownerId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return { rows: selectedRows as T[], rowCount: selectedRows.length };
    }

    throw new Error(`Unhandled fake query: ${sql}`);
  }
}

function cloneCredentialRow(row: CredentialRow): CredentialRow {
  return {
    ...row,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    revoked_at: row.revoked_at ? new Date(row.revoked_at) : null
  };
}

describe("PostgresCredentialStore", () => {
  test("save stores ciphertext and never plaintext", async () => {
    const queryable = new FakeCredentialQueryable();
    const cipher = createCredentialCipher({ activeKeyVersion: "v1", keys: { v1: key() } });
    const store = new PostgresCredentialStore({ queryable, cipher });

    const saved = await store.save({ ownerId: "owner-1", plaintext: "clockify-secret-api-key-123" });

    expect(saved.ciphertext).not.toBe("clockify-secret-api-key-123");
    expect(queryable.rows).toHaveLength(1);
    expect(JSON.stringify(queryable.rows[0])).not.toContain("clockify-secret-api-key-123");
    await expect(store.decryptActive({ ownerId: "owner-1", credentialId: saved.id })).resolves.toBe(
      "clockify-secret-api-key-123"
    );
  });

  test("save revokes the previous active owner credential before inserting a new one", async () => {
    const queryable = new FakeCredentialQueryable();
    const cipher = createCredentialCipher({ activeKeyVersion: "v1", keys: { v1: key() } });
    const store = new PostgresCredentialStore({ queryable, cipher });
    const first = await store.save({
      ownerId: "owner-1",
      plaintext: "first-secret",
      now: new Date("2026-01-01T00:00:00.000Z")
    });
    queryable.operations.length = 0;

    const second = await store.save({
      ownerId: "owner-1",
      plaintext: "second-secret",
      now: new Date("2026-01-02T00:00:00.000Z")
    });

    expect(await store.getActive({ ownerId: "owner-1", credentialId: first.id })).toBeUndefined();
    expect(await store.getActiveByOwnerId({ ownerId: "owner-1" })).toMatchObject({ id: second.id });
    expect(queryable.rows.filter((row) => row.owner_id === "owner-1" && row.revoked_at === null)).toHaveLength(1);
    expect(queryable.operations).toEqual(["connect", "begin", "update-active", "insert", "commit", "release"]);
  });

  test("save keeps the previous active credential when replacement insert fails", async () => {
    const queryable = new FakeCredentialQueryable();
    const cipher = createCredentialCipher({ activeKeyVersion: "v1", keys: { v1: key() } });
    const store = new PostgresCredentialStore({ queryable, cipher });
    const first = await store.save({
      ownerId: "owner-1",
      plaintext: "first-secret",
      now: new Date("2026-01-01T00:00:00.000Z")
    });
    queryable.operations.length = 0;

    queryable.failNextInsert = true;

    await expect(
      store.save({
        ownerId: "owner-1",
        plaintext: "second-secret",
        now: new Date("2026-01-02T00:00:00.000Z")
      })
    ).rejects.toThrow(/insert failed/);

    expect(await store.getActive({ ownerId: "owner-1", credentialId: first.id })).toMatchObject({ id: first.id });
    await expect(store.decryptActiveByOwnerId({ ownerId: "owner-1" })).resolves.toBe("first-secret");
    expect(queryable.rows.filter((row) => row.owner_id === "owner-1" && row.revoked_at === null)).toHaveLength(1);
    expect(queryable.operations).toEqual(["connect", "begin", "update-active", "insert", "rollback", "release"]);
  });

  test("decryptActiveByOwnerId decrypts the active owner credential", async () => {
    const queryable = new FakeCredentialQueryable();
    const cipher = createCredentialCipher({ activeKeyVersion: "v1", keys: { v1: key() } });
    const store = new PostgresCredentialStore({ queryable, cipher });
    await store.save({ ownerId: "owner-1", plaintext: "owner-secret" });

    await expect(store.decryptActiveByOwnerId({ ownerId: "owner-1" })).resolves.toBe("owner-secret");
    await expect(store.decryptActiveByOwnerId({ ownerId: "missing-owner" })).rejects.toThrow(AuthorizationError);
  });

  test("revokeActiveByOwnerId revokes the active credential for one owner", async () => {
    const queryable = new FakeCredentialQueryable();
    const cipher = createCredentialCipher({ activeKeyVersion: "v1", keys: { v1: key() } });
    const store = new PostgresCredentialStore({ queryable, cipher });
    const ownerCredential = await store.save({ ownerId: "owner-1", plaintext: "owner-secret" });
    const otherOwnerCredential = await store.save({ ownerId: "owner-2", plaintext: "other-secret" });

    const revoked = await store.revokeActiveByOwnerId({
      ownerId: "owner-1",
      now: new Date("2026-01-03T00:00:00.000Z")
    });

    expect(revoked).toMatchObject({
      id: ownerCredential.id,
      revokedAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z"
    });
    expect(await store.getActiveByOwnerId({ ownerId: "owner-1" })).toBeUndefined();
    expect(await store.getActiveByOwnerId({ ownerId: "owner-2" })).toMatchObject({ id: otherOwnerCredential.id });
  });

  test("deleteByOwnerId removes every credential for one owner", async () => {
    const queryable = new FakeCredentialQueryable();
    const cipher = createCredentialCipher({ activeKeyVersion: "v1", keys: { v1: key() } });
    const store = new PostgresCredentialStore({ queryable, cipher });
    await store.save({ ownerId: "owner-1", plaintext: "first-secret" });
    await store.save({ ownerId: "owner-1", plaintext: "second-secret" });
    const otherOwnerCredential = await store.save({ ownerId: "owner-2", plaintext: "other-secret" });

    await expect(store.deleteByOwnerId({ ownerId: "owner-1" })).resolves.toBe(2);

    await expect(store.list({ ownerId: "owner-1" })).resolves.toEqual([]);
    await expect(store.decryptActiveByOwnerId({ ownerId: "owner-1" })).rejects.toThrow(AuthorizationError);
    await expect(store.getActiveByOwnerId({ ownerId: "owner-2" })).resolves.toMatchObject({
      id: otherOwnerCredential.id
    });
  });
});
