import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;
const DEFAULT_KEY_ENV_NAME = "CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY";
const DEFAULT_KEY_VERSION_ENV_NAME = "CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY_VERSION";

export type EncryptedCredentialRecord = {
  ownerId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
};

export type CredentialCipher = {
  encryptCredential(input: { ownerId: string; plaintext: string; now?: Date }): EncryptedCredentialRecord;
  decryptCredential(record: EncryptedCredentialRecord): string;
};

export type CredentialCipherConfig = {
  activeKeyVersion: string;
  keys: Record<string, string>;
};

export type CredentialCipherEnvConfig = {
  env?: NodeJS.ProcessEnv;
  keyEnvName?: string;
  keyVersionEnvName?: string;
};

export class CredentialCryptoError extends Error {
  constructor(message = "Credential crypto operation failed") {
    super(message);
    this.name = "CredentialCryptoError";
  }
}

export function createCredentialCipher(config: CredentialCipherConfig): CredentialCipher {
  const keys = new Map<string, Buffer>();
  for (const [version, encodedKey] of Object.entries(config.keys)) {
    keys.set(version, decodeBase64Key(encodedKey, version));
  }

  if (!keys.has(config.activeKeyVersion)) {
    throw new CredentialCryptoError("Active credential encryption key version is not configured");
  }

  return {
    encryptCredential({ ownerId, plaintext, now = new Date() }) {
      const key = keys.get(config.activeKeyVersion);
      if (!key) {
        throw new CredentialCryptoError("Active credential encryption key version is not configured");
      }

      const iv = randomBytes(IV_LENGTH_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
      cipher.setAAD(aadFor(ownerId, config.activeKeyVersion));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const timestamp = now.toISOString();

      return {
        ownerId,
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        keyVersion: config.activeKeyVersion,
        fingerprint: fingerprintCredential(plaintext),
        createdAt: timestamp,
        updatedAt: timestamp
      };
    },

    decryptCredential(record) {
      try {
        const key = keys.get(record.keyVersion);
        if (!key) {
          throw new CredentialCryptoError();
        }

        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(record.iv, "base64"), {
          authTagLength: AUTH_TAG_LENGTH_BYTES
        });
        decipher.setAAD(aadFor(record.ownerId, record.keyVersion));
        decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
        return Buffer.concat([
          decipher.update(Buffer.from(record.ciphertext, "base64")),
          decipher.final()
        ]).toString("utf8");
      } catch (error) {
        if (error instanceof CredentialCryptoError) {
          throw error;
        }
        throw new CredentialCryptoError();
      }
    }
  };
}

export function createCredentialCipherFromEnv(config: CredentialCipherEnvConfig = {}): CredentialCipher {
  const env = config.env ?? process.env;
  const keyEnvName = config.keyEnvName ?? DEFAULT_KEY_ENV_NAME;
  const keyVersionEnvName = config.keyVersionEnvName ?? DEFAULT_KEY_VERSION_ENV_NAME;
  const activeKeyVersion = env[keyVersionEnvName];
  const encodedKey = env[keyEnvName];

  if (!activeKeyVersion || !encodedKey) {
    throw new CredentialCryptoError("Credential encryption key and key version are required");
  }

  return createCredentialCipher({
    activeKeyVersion,
    keys: { [activeKeyVersion]: encodedKey }
  });
}

function decodeBase64Key(encodedKey: string, version: string): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== KEY_LENGTH_BYTES || key.toString("base64") !== encodedKey) {
    throw new CredentialCryptoError(`Credential encryption key ${version} must be 32 base64-encoded bytes`);
  }
  return key;
}

function aadFor(ownerId: string, keyVersion: string): Buffer {
  return Buffer.from(`${ownerId}:${keyVersion}`, "utf8");
}

function fingerprintCredential(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}
