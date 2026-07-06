export class AuthorizationError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export type ScopedTokenPayload = {
  sub: string;
  clientId: string;
  scopes: string[];
};

export function requireScopes(tokenPayload: ScopedTokenPayload, requiredScopes: readonly string[]): void {
  const grantedScopes = new Set(tokenPayload.scopes);
  const missingScopes = requiredScopes.filter((scope) => !grantedScopes.has(scope));
  if (missingScopes.length > 0) {
    throw new AuthorizationError(`Missing required scope: ${missingScopes.join(", ")}`);
  }
}

export function assertCredentialOwner(actualOwnerId: string, expectedOwnerId: string): void {
  if (actualOwnerId !== expectedOwnerId) {
    throw new AuthorizationError("Credential owner mismatch");
  }
}
