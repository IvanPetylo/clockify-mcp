const REDACTED = "[redacted]";

const SECRET_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "access_token",
  "refresh_token",
  "refreshtoken",
  "id_token",
  "api_key",
  "apikey",
  "x-api-key",
  "x_api_key",
  "clockify_api_key",
  "code",
  "state",
  "code_verifier",
  "client_secret"
]);

export function redactSecrets<T>(value: T): T {
  return redactValue(value, new WeakSet()) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return redactError(value, seen);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        isSecretKey(key) ? REDACTED : redactValue(nestedValue, seen)
      ])
    );
  }
  if (typeof value === "string") {
    return redactSecretPatterns(value);
  }
  return value;
}

function redactError(error: Error, seen: WeakSet<object>): Record<string, unknown> {
  seen.add(error);
  return {
    name: error.name,
    message: redactSecretPatterns(error.message),
    stack: error.stack ? redactSecretPatterns(error.stack) : undefined,
    ...Object.fromEntries(
      Object.entries(error).map(([key, nestedValue]) => [
        key,
        isSecretKey(key) ? REDACTED : redactValue(nestedValue, seen)
      ])
    )
  };
}

function isSecretKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[-\s]/g, "_");
  return SECRET_KEYS.has(key.toLowerCase()) || SECRET_KEYS.has(normalized) || normalized.includes("secret");
}

function redactSecretPatterns(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/((?:client_secret|clientSecret)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/((?:access_token|accessToken)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/((?:refresh_token|refreshToken)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/((?:id_token|idToken)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/((?:clockify_api_key|clockifyApiKey)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/((?:code_verifier|codeVerifier)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/((?:x-api-key|x_api_key|api_key|apiKey|code|state)=)[^&\s]+/gi, "$1[redacted]");
}
