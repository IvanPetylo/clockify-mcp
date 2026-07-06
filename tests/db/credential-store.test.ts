import { randomBytes } from "node:crypto";

import { createCredentialCipher } from "../../src/auth/crypto.js";
import { AuthorizationError } from "../../src/auth/authorization.js";
import { InMemoryCredentialStore } from "../../src/db/credential-store.js";

function key(): string {
  return randomBytes(32).toString("base64");
}

describe("InMemoryCredentialStore", () => {
  test("revoke makes a credential unavailable", () => {
    const cipher = createCredentialCipher({ activeKeyVersion: "v1", keys: { v1: key() } });
    const store = new InMemoryCredentialStore({ cipher });
    const saved = store.save({ ownerId: "owner-1", plaintext: "clockify-secret-api-key-123" });

    store.revoke({ ownerId: "owner-1", credentialId: saved.id });

    expect(store.getActive({ ownerId: "owner-1", credentialId: saved.id })).toBeUndefined();
    expect(store.list({ ownerId: "owner-1" })[0]).toMatchObject({ id: saved.id, revokedAt: expect.any(String) });
  });

  test("owner A cannot get or decrypt owner B credential", () => {
    const cipher = createCredentialCipher({ activeKeyVersion: "v1", keys: { v1: key() } });
    const store = new InMemoryCredentialStore({ cipher });
    const saved = store.save({ ownerId: "owner-b", plaintext: "clockify-secret-api-key-123" });

    expect(store.getActive({ ownerId: "owner-a", credentialId: saved.id })).toBeUndefined();
    expect(() => store.decryptActive({ ownerId: "owner-a", credentialId: saved.id })).toThrow(AuthorizationError);
    expect(store.decryptActive({ ownerId: "owner-b", credentialId: saved.id })).toBe("clockify-secret-api-key-123");
  });

  test("gets and decrypts the latest active credential by owner id", () => {
    const cipher = createCredentialCipher({ activeKeyVersion: "v1", keys: { v1: key() } });
    const store = new InMemoryCredentialStore({ cipher });
    const older = store.save({
      ownerId: "owner-1",
      plaintext: "older-secret",
      now: new Date("2026-01-01T00:00:00.000Z")
    });
    const newer = store.save({
      ownerId: "owner-1",
      plaintext: "newer-secret",
      now: new Date("2026-01-02T00:00:00.000Z")
    });
    store.revoke({ ownerId: "owner-1", credentialId: older.id, now: new Date("2026-01-03T00:00:00.000Z") });

    expect(store.getActiveByOwnerId({ ownerId: "owner-1" })).toMatchObject({ id: newer.id });
    expect(store.decryptActiveByOwnerId({ ownerId: "owner-1" })).toBe("newer-secret");
  });

  test("revokeActiveByOwnerId revokes the currently active owner credential", () => {
    const cipher = createCredentialCipher({ activeKeyVersion: "v1", keys: { v1: key() } });
    const store = new InMemoryCredentialStore({ cipher });
    const ownerCredential = store.save({ ownerId: "owner-1", plaintext: "owner-secret" });
    const otherOwnerCredential = store.save({ ownerId: "owner-2", plaintext: "other-owner-secret" });

    const revoked = store.revokeActiveByOwnerId({
      ownerId: "owner-1",
      now: new Date("2026-01-03T00:00:00.000Z")
    });

    expect(revoked).toMatchObject({
      id: ownerCredential.id,
      revokedAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z"
    });
    expect(store.getActiveByOwnerId({ ownerId: "owner-1" })).toBeUndefined();
    expect(() => store.decryptActiveByOwnerId({ ownerId: "owner-1" })).toThrow(AuthorizationError);
    expect(store.getActiveByOwnerId({ ownerId: "owner-2" })).toMatchObject({ id: otherOwnerCredential.id });
  });

  test("deleteByOwnerId removes every credential for one owner", () => {
    const cipher = createCredentialCipher({ activeKeyVersion: "v1", keys: { v1: key() } });
    const store = new InMemoryCredentialStore({ cipher });
    store.save({ ownerId: "owner-1", plaintext: "first-owner-secret" });
    store.save({ ownerId: "owner-1", plaintext: "second-owner-secret" });
    const otherOwnerCredential = store.save({ ownerId: "owner-2", plaintext: "other-owner-secret" });

    expect(store.deleteByOwnerId({ ownerId: "owner-1" })).toBe(2);

    expect(store.list({ ownerId: "owner-1" })).toEqual([]);
    expect(() => store.decryptActiveByOwnerId({ ownerId: "owner-1" })).toThrow(AuthorizationError);
    expect(store.getActiveByOwnerId({ ownerId: "owner-2" })).toMatchObject({ id: otherOwnerCredential.id });
  });
});
