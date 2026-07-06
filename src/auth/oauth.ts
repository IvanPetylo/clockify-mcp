import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { issueAccessToken } from "./jwt.js";

export type OAuthServiceConfig = {
  issuer: string;
  resource: string;
  jwtSecret: Uint8Array | string;
  allowedRedirectUris: string[];
  allowedScopes?: string[];
  authorizationCodeStore?: AuthorizationCodeStore;
  tokenTtlSeconds?: number;
  codeTtlMs?: number;
};

export type AuthorizationCodeRequest = {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  resource: string;
  scope: string;
  subject: string;
};

export type AuthorizationRequestValidation = Omit<AuthorizationCodeRequest, "subject"> & {
  subject?: string;
};

export type TokenRequest = {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_verifier: string;
  resource: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
};

type MaybePromise<T> = Promise<T> | T;

export type StoredAuthorizationCode = {
  code: string;
  subject: string;
  clientId: string;
  resource: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  expiresAt: Date;
  createdAt: Date;
  consumedAt?: Date;
};

export type AuthorizationCodeStore = {
  saveAuthorizationCode(record: StoredAuthorizationCode): MaybePromise<void>;
  getAuthorizationCode(input: { code: string; now?: Date }): MaybePromise<StoredAuthorizationCode | undefined>;
  consumeAuthorizationCode(input: { code: string; now?: Date }): MaybePromise<StoredAuthorizationCode | undefined>;
};

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthError";
  }
}

export class InMemoryAuthorizationCodeStore implements AuthorizationCodeStore {
  private readonly codes = new Map<string, StoredAuthorizationCode>();

  saveAuthorizationCode(record: StoredAuthorizationCode): void {
    this.codes.set(record.code, { ...record });
  }

  getAuthorizationCode(input: { code: string; now?: Date }): StoredAuthorizationCode | undefined {
    const now = input.now ?? new Date();
    const stored = this.codes.get(input.code);
    if (!stored || stored.consumedAt || stored.expiresAt <= now) {
      return undefined;
    }
    return { ...stored };
  }

  consumeAuthorizationCode(input: { code: string; now?: Date }): StoredAuthorizationCode | undefined {
    const now = input.now ?? new Date();
    const stored = this.codes.get(input.code);
    if (!stored || stored.consumedAt || stored.expiresAt <= now) {
      return undefined;
    }
    const consumed = { ...stored, consumedAt: now };
    this.codes.set(input.code, consumed);
    return consumed;
  }
}

export function createOAuthService(config: OAuthServiceConfig) {
  const authorizationCodeStore = config.authorizationCodeStore ?? new InMemoryAuthorizationCodeStore();
  const tokenTtlSeconds = config.tokenTtlSeconds ?? 3600;
  const codeTtlMs = config.codeTtlMs ?? 5 * 60 * 1000;

  return {
    validateAuthorizationRequest(request: AuthorizationRequestValidation) {
      validateAuthorizationRequest(config, request, { requireSubject: false });
    },

    async createAuthorizationCode(request: AuthorizationCodeRequest) {
      validateAuthorizationRequest(config, request, { requireSubject: true });
      const code = randomBytes(32).toString("base64url");
      const createdAt = new Date();
      await authorizationCodeStore.saveAuthorizationCode({
        code,
        subject: request.subject,
        clientId: request.client_id,
        resource: request.resource,
        redirectUri: request.redirect_uri,
        codeChallenge: request.code_challenge,
        codeChallengeMethod: request.code_challenge_method,
        scope: normalizeScope(request.scope),
        expiresAt: new Date(createdAt.getTime() + codeTtlMs),
        createdAt
      });
      return { code, state: request.state };
    },

    async exchangeAuthorizationCode(request: TokenRequest): Promise<TokenResponse> {
      const now = new Date();
      const stored = await authorizationCodeStore.getAuthorizationCode({ code: request.code, now });
      if (!stored) {
        throw new OAuthError("Invalid authorization code");
      }
      if (stored.clientId !== request.client_id || stored.redirectUri !== request.redirect_uri) {
        throw new OAuthError("Invalid authorization code binding");
      }
      if (stored.resource !== request.resource || stored.resource !== config.resource) {
        throw new OAuthError("Invalid OAuth resource");
      }
      if (!verifyPkce(request.code_verifier, stored.codeChallenge)) {
        throw new OAuthError("Invalid PKCE verifier");
      }
      const consumed = await authorizationCodeStore.consumeAuthorizationCode({ code: request.code, now });
      if (!consumed) {
        throw new OAuthError("Invalid authorization code");
      }

      const accessToken = await issueAccessToken({
        secret: config.jwtSecret,
        issuer: config.issuer,
        audience: config.resource,
        subject: consumed.subject,
        clientId: consumed.clientId,
        scopes: consumed.scope.split(" "),
        expiresIn: `${tokenTtlSeconds}s`
      });

      return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: tokenTtlSeconds,
        scope: consumed.scope
      };
    }
  };
}

function validateAuthorizationRequest(
  config: OAuthServiceConfig,
  request: AuthorizationRequestValidation,
  options: { requireSubject: boolean }
): void {
  if (request.response_type !== "code") {
    throw new OAuthError("Only authorization code flow is supported");
  }
  if (!config.allowedRedirectUris.includes(request.redirect_uri)) {
    throw new OAuthError("Unregistered redirect URI");
  }
  if (!request.client_id) {
    throw new OAuthError("OAuth client_id is required");
  }
  if (request.resource !== config.resource) {
    throw new OAuthError("Invalid OAuth resource");
  }
  if (request.code_challenge_method !== "S256" || !request.code_challenge) {
    throw new OAuthError("PKCE S256 is required");
  }
  if (!isValidPkceChallenge(request.code_challenge)) {
    throw new OAuthError("Invalid PKCE code challenge");
  }
  if (!request.state) {
    throw new OAuthError("OAuth state is required");
  }
  if (options.requireSubject && !request.subject) {
    throw new OAuthError("Authorization subject is required");
  }
  validateRequestedScopes(config, request.scope);
}

function normalizeScope(scope: string): string {
  return scope
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function validateRequestedScopes(config: OAuthServiceConfig, scope: string): void {
  if (!config.allowedScopes) {
    return;
  }
  const allowedScopes = new Set(config.allowedScopes);
  for (const requestedScope of normalizeScope(scope).split(" ").filter(Boolean)) {
    if (!allowedScopes.has(requestedScope)) {
      throw new OAuthError(`Unsupported OAuth scope: ${requestedScope}`);
    }
  }
}

function verifyPkce(verifier: string, expectedChallenge: string): boolean {
  if (!isValidPkceVerifier(verifier)) {
    return false;
  }
  const actual = createHash("sha256").update(verifier).digest("base64url");
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expectedChallenge);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function isValidPkceChallenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isValidPkceVerifier(value: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}
