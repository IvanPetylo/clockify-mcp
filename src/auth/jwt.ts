import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { nanoid } from "nanoid";

import { requireScopes } from "./authorization.js";

export { requireScopes } from "./authorization.js";

export type AccessTokenPayload = JWTPayload & {
  sub: string;
  jti?: string;
  clientId: string;
  scopes: string[];
};

export type TokenRevocationStore = {
  isRevoked(tokenId: string): Promise<boolean> | boolean;
  revoke(input: {
    tokenId: string;
    ownerId: string;
    clientId?: string;
    expiresAt?: Date;
    now?: Date;
  }): Promise<void> | void;
};

export type IssueAccessTokenOptions = {
  secret: Uint8Array | string;
  issuer: string;
  audience: string;
  subject: string;
  clientId: string;
  scopes: string[];
  expiresIn: string | number;
  tokenId?: string;
};

export type VerifyAccessTokenOptions = {
  secret: Uint8Array | string;
  issuer: string;
  audience: string;
  revocationStore?: TokenRevocationStore;
};

export class TokenVerificationError extends Error {
  constructor(message = "Access token verification failed") {
    super(message);
    this.name = "TokenVerificationError";
  }
}

export async function issueAccessToken(options: IssueAccessTokenOptions): Promise<string> {
  return new SignJWT({
    clientId: options.clientId,
    scopes: options.scopes
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setSubject(options.subject)
    .setJti(options.tokenId ?? nanoid())
    .setIssuedAt()
    .setExpirationTime(options.expiresIn)
    .sign(normalizeSecret(options.secret));
}

export async function verifyAccessToken(token: string, options: VerifyAccessTokenOptions): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, normalizeSecret(options.secret), {
      issuer: options.issuer,
      audience: options.audience
    });
    const accessTokenPayload = normalizePayload(payload);
    if (options.revocationStore && (await options.revocationStore.isRevoked(accessTokenPayload.jti))) {
      throw new TokenVerificationError("Access token has been revoked");
    }
    requireScopes(accessTokenPayload, []);
    return accessTokenPayload;
  } catch (error) {
    if (error instanceof TokenVerificationError) {
      throw error;
    }
    throw new TokenVerificationError();
  }
}

function normalizeSecret(secret: Uint8Array | string): Uint8Array {
  return typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
}

function normalizePayload(payload: JWTPayload): AccessTokenPayload & { jti: string } {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new TokenVerificationError("Access token subject is required");
  }
  if (typeof payload.clientId !== "string" || payload.clientId.length === 0) {
    throw new TokenVerificationError("Access token clientId is required");
  }
  if (typeof payload.jti !== "string" || payload.jti.length === 0) {
    throw new TokenVerificationError("Access token jti is required");
  }
  if (!Array.isArray(payload.scopes) || payload.scopes.some((scope) => typeof scope !== "string")) {
    throw new TokenVerificationError("Access token scopes are required");
  }
  if (typeof payload.exp !== "number") {
    throw new TokenVerificationError("Access token expiration is required");
  }

  return payload as AccessTokenPayload & { jti: string };
}
