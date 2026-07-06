import { nanoid } from "nanoid";

import { assertCredentialOwner, AuthorizationError } from "../auth/authorization.js";
import type { CredentialCipher, EncryptedCredentialRecord } from "../auth/crypto.js";

export type StoredCredentialRecord = EncryptedCredentialRecord & {
  id: string;
};

export type CredentialStoreConfig = {
  cipher: CredentialCipher;
};

type MaybePromise<T> = Promise<T> | T;

export type CredentialStore = {
  save(input: { ownerId: string; plaintext: string; now?: Date }): MaybePromise<StoredCredentialRecord>;
  getActive(input: { ownerId: string; credentialId: string }): MaybePromise<StoredCredentialRecord | undefined>;
  getActiveByOwnerId(input: { ownerId: string }): MaybePromise<StoredCredentialRecord | undefined>;
  decryptActive(input: { ownerId: string; credentialId: string }): MaybePromise<string>;
  decryptActiveByOwnerId(input: { ownerId: string }): MaybePromise<string>;
  revoke(input: {
    ownerId: string;
    credentialId: string;
    now?: Date;
  }): MaybePromise<StoredCredentialRecord | undefined>;
  revokeActiveByOwnerId(input: { ownerId: string; now?: Date }): MaybePromise<StoredCredentialRecord | undefined>;
  deleteByOwnerId(input: { ownerId: string }): MaybePromise<number>;
  list(input: { ownerId: string }): MaybePromise<StoredCredentialRecord[]>;
};

export class InMemoryCredentialStore implements CredentialStore {
  private readonly cipher: CredentialCipher;
  private readonly records = new Map<string, StoredCredentialRecord>();

  constructor(config: CredentialStoreConfig) {
    this.cipher = config.cipher;
  }

  save(input: { ownerId: string; plaintext: string; now?: Date }): StoredCredentialRecord {
    const encrypted = this.cipher.encryptCredential(input);
    const record = {
      id: nanoid(),
      ...encrypted
    };
    this.records.set(record.id, record);
    return record;
  }

  getActive(input: { ownerId: string; credentialId: string }): StoredCredentialRecord | undefined {
    const record = this.records.get(input.credentialId);
    if (!record || record.revokedAt) {
      return undefined;
    }
    if (record.ownerId !== input.ownerId) {
      return undefined;
    }
    return record;
  }

  getActiveByOwnerId(input: { ownerId: string }): StoredCredentialRecord | undefined {
    return this.list(input)
      .filter((record) => !record.revokedAt)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  }

  decryptActive(input: { ownerId: string; credentialId: string }): string {
    const record = this.records.get(input.credentialId);
    if (!record || record.revokedAt) {
      throw new AuthorizationError("Credential is unavailable");
    }
    assertCredentialOwner(record.ownerId, input.ownerId);
    return this.cipher.decryptCredential(record);
  }

  decryptActiveByOwnerId(input: { ownerId: string }): string {
    const record = this.getActiveByOwnerId(input);
    if (!record) {
      throw new AuthorizationError("Credential is unavailable");
    }
    return this.cipher.decryptCredential(record);
  }

  revoke(input: { ownerId: string; credentialId: string; now?: Date }): StoredCredentialRecord | undefined {
    const record = this.records.get(input.credentialId);
    if (!record || record.ownerId !== input.ownerId) {
      return undefined;
    }
    const timestamp = (input.now ?? new Date()).toISOString();
    const revoked = {
      ...record,
      revokedAt: timestamp,
      updatedAt: timestamp
    };
    this.records.set(record.id, revoked);
    return revoked;
  }

  revokeActiveByOwnerId(input: { ownerId: string; now?: Date }): StoredCredentialRecord | undefined {
    const record = this.getActiveByOwnerId(input);
    if (!record) {
      return undefined;
    }
    return this.revoke({ ownerId: input.ownerId, credentialId: record.id, now: input.now });
  }

  deleteByOwnerId(input: { ownerId: string }): number {
    let deletedCount = 0;
    for (const [id, record] of this.records) {
      if (record.ownerId === input.ownerId) {
        this.records.delete(id);
        deletedCount += 1;
      }
    }
    return deletedCount;
  }

  list(input: { ownerId: string }): StoredCredentialRecord[] {
    return [...this.records.values()].filter((record) => record.ownerId === input.ownerId);
  }
}
