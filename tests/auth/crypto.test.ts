import { randomBytes } from "node:crypto";

import {
  createCredentialCipher,
  CredentialCryptoError,
  type EncryptedCredentialRecord
} from "../../src/auth/crypto.js";

function key(): string {
  return randomBytes(32).toString("base64");
}

describe("credential encryption", () => {
  test("roundtrips a Clockify API key without serializing plaintext", () => {
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: key() }
    });
    const plaintext = "clockify-secret-api-key-123";

    const record = cipher.encryptCredential({ ownerId: "owner-1", plaintext });

    expect(record).toMatchObject({
      ownerId: "owner-1",
      keyVersion: "v1"
    });
    expect(record.revokedAt).toBeUndefined();
    expect(record.createdAt).toEqual(expect.any(String));
    expect(record.updatedAt).toEqual(expect.any(String));
    expect(record.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.toContain(plaintext);
    expect(cipher.decryptCredential(record)).toBe(plaintext);
  });

  test("tampered ciphertext or auth tag fails closed", () => {
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: key() }
    });
    const record = cipher.encryptCredential({ ownerId: "owner-1", plaintext: "clockify-secret-api-key-123" });

    expect(() => cipher.decryptCredential({ ...record, ciphertext: `${record.ciphertext.slice(0, -2)}aa` })).toThrow(
      CredentialCryptoError
    );
    expect(() => cipher.decryptCredential({ ...record, authTag: `${record.authTag.slice(0, -2)}aa` })).toThrow(
      CredentialCryptoError
    );
  });

  test("unknown key version fails closed", () => {
    const cipher = createCredentialCipher({
      activeKeyVersion: "v1",
      keys: { v1: key() }
    });
    const record: EncryptedCredentialRecord = cipher.encryptCredential({
      ownerId: "owner-1",
      plaintext: "clockify-secret-api-key-123"
    });

    expect(() => cipher.decryptCredential({ ...record, keyVersion: "v2" })).toThrow(CredentialCryptoError);
  });
});
