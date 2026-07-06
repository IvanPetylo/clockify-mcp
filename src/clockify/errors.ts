export type ClockifyErrorCode =
  | "CLOCKIFY_VALIDATION_ERROR"
  | "CLOCKIFY_AUTH_ERROR"
  | "CLOCKIFY_FORBIDDEN"
  | "CLOCKIFY_NOT_FOUND"
  | "CLOCKIFY_CONFLICT"
  | "CLOCKIFY_RATE_LIMITED"
  | "CLOCKIFY_UPSTREAM_ERROR"
  | "CLOCKIFY_NETWORK_ERROR"
  | "CLOCKIFY_PAGINATION_LIMIT";

export class ClockifyApiError extends Error {
  readonly status?: number;
  readonly code: ClockifyErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly details?: unknown;
  readonly raw?: unknown;

  constructor(args: {
    status?: number;
    code: ClockifyErrorCode;
    message: string;
    retryable?: boolean;
    retryAfterMs?: number;
    details?: unknown;
    raw?: unknown;
  }) {
    super(args.message);
    this.name = "ClockifyApiError";
    this.status = args.status;
    this.code = args.code;
    this.retryable = args.retryable ?? false;
    this.retryAfterMs = args.retryAfterMs;
    this.details = args.details;
    this.raw = args.raw;
  }
}

export function redactClockifySecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]");
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactClockifySecrets(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes("api") || lowerKey.includes("token") || lowerKey.includes("authorization")) {
          return [key, "[redacted]"];
        }
        return [key, redactClockifySecrets(item)];
      })
    );
  }

  return value;
}

export function errorCodeForStatus(status: number): ClockifyErrorCode {
  if (status === 400 || status === 422) return "CLOCKIFY_VALIDATION_ERROR";
  if (status === 401) return "CLOCKIFY_AUTH_ERROR";
  if (status === 403) return "CLOCKIFY_FORBIDDEN";
  if (status === 404) return "CLOCKIFY_NOT_FOUND";
  if (status === 409) return "CLOCKIFY_CONFLICT";
  if (status === 429) return "CLOCKIFY_RATE_LIMITED";
  return "CLOCKIFY_UPSTREAM_ERROR";
}
