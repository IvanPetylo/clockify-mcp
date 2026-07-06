import { ClockifyApiError, errorCodeForStatus, redactClockifySecrets } from "./errors.js";
import type {
  ClockifyClientConfig,
  ClockifyEntity,
  ClockifyReportSummary,
  ClockifyTimeEntry,
  ClockifyUser,
  ClockifyWorkspace,
  PaginationOptions,
  StartTimerPayload,
  SummaryReportFilters,
  TimeEntryFilters,
  TimeEntryPayload
} from "./types.js";

const DEFAULT_API_BASE_URL = "https://api.clockify.me/api/v1";
const DEFAULT_REPORTS_BASE_URL = "https://reports.api.clockify.me/v1";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

type PageRequest = {
  page: number;
  pageSize: number;
};

type RequestJsonOptions = {
  method?: string;
  baseUrl?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  retryMutations?: boolean;
};

export class ClockifyClient {
  private readonly apiKey: string;
  private readonly apiBaseUrl: string;
  private readonly reportsBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;

  constructor(config: ClockifyClientConfig) {
    this.apiKey = config.apiKey;
    this.apiBaseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    this.reportsBaseUrl = config.reportsBaseUrl ?? DEFAULT_REPORTS_BASE_URL;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxAttempts = config.retry?.maxAttempts ?? 3;
    this.baseDelayMs = config.retry?.baseDelayMs ?? 250;
  }

  async getProfile(): Promise<ClockifyUser> {
    return this.requestJson<ClockifyUser>("GET", "/user");
  }

  async listWorkspaces(): Promise<ClockifyWorkspace[]> {
    return this.requestJson<ClockifyWorkspace[]>("GET", "/workspaces");
  }

  async searchClients(workspaceId: string, query?: string, options: PaginationOptions = {}): Promise<ClockifyEntity[]> {
    return this.paginateQuery(`/workspaces/${workspaceId}/clients`, { name: query }, options);
  }

  async searchProjects(workspaceId: string, query?: string, options: PaginationOptions = {}): Promise<ClockifyEntity[]> {
    return this.paginateQuery(`/workspaces/${workspaceId}/projects`, { name: query, archived: false }, options);
  }

  async searchTasks(
    workspaceId: string,
    projectId: string,
    query?: string,
    options: PaginationOptions = {}
  ): Promise<ClockifyEntity[]> {
    return this.paginateQuery(`/workspaces/${workspaceId}/projects/${projectId}/tasks`, { name: query }, options);
  }

  async searchTags(workspaceId: string, query?: string, options: PaginationOptions = {}): Promise<ClockifyEntity[]> {
    return this.paginateQuery(`/workspaces/${workspaceId}/tags`, { name: query }, options);
  }

  async listTimeEntries(
    workspaceId: string,
    userId: string,
    filters: TimeEntryFilters = {},
    options: PaginationOptions = {}
  ): Promise<ClockifyTimeEntry[]> {
    return this.paginateQuery(
      `/workspaces/${workspaceId}/user/${userId}/time-entries`,
      {
        start: filters.start,
        end: filters.end,
        project: filters.projectId,
        task: filters.taskId,
        tags: filters.tags?.join(","),
        inProgress: filters.inProgress
      },
      options
    );
  }

  async getCurrentTimer(workspaceId: string, userId: string): Promise<ClockifyTimeEntry | null> {
    const entries = await this.requestJson<ClockifyTimeEntry[]>(
      "GET",
      `/workspaces/${workspaceId}/user/${userId}/time-entries`,
      { query: { inProgress: true, page: 1, "page-size": 1 } }
    );
    return entries[0] ?? null;
  }

  async startTimer(workspaceId: string, payload: StartTimerPayload): Promise<ClockifyTimeEntry> {
    return this.requestJson<ClockifyTimeEntry>("POST", `/workspaces/${workspaceId}/time-entries`, {
      body: {
        start: payload.start,
        description: payload.description,
        projectId: payload.projectId,
        taskId: payload.taskId,
        tagIds: payload.tagIds
      }
    });
  }

  async stopTimer(workspaceId: string, userId: string, endedAt: string): Promise<ClockifyTimeEntry> {
    return this.requestJson<ClockifyTimeEntry>("PATCH", `/workspaces/${workspaceId}/user/${userId}/time-entries`, {
      body: { end: endedAt }
    });
  }

  async createTimeEntry(workspaceId: string, payload: TimeEntryPayload): Promise<ClockifyTimeEntry> {
    return this.requestJson<ClockifyTimeEntry>("POST", `/workspaces/${workspaceId}/time-entries`, { body: payload });
  }

  async updateTimeEntry(workspaceId: string, entryId: string, payload: TimeEntryPayload): Promise<ClockifyTimeEntry> {
    return this.requestJson<ClockifyTimeEntry>("PUT", `/workspaces/${workspaceId}/time-entries/${entryId}`, {
      body: payload
    });
  }

  async deleteTimeEntry(workspaceId: string, entryId: string): Promise<void> {
    await this.requestJson<void>("DELETE", `/workspaces/${workspaceId}/time-entries/${entryId}`);
  }

  async getSummaryReport(
    workspaceId: string,
    filters: SummaryReportFilters,
    options: PaginationOptions = {}
  ): Promise<ClockifyReportSummary> {
    const pageSize = normalizePageSize(options.pageSize);
    return this.requestJson<ClockifyReportSummary>("POST", `/workspaces/${workspaceId}/reports/summary`, {
      baseUrl: this.reportsBaseUrl,
      body: {
        dateRangeStart: filters.dateRangeStart,
        dateRangeEnd: filters.dateRangeEnd,
        summaryFilter: {
          page: 1,
          pageSize,
          groups: ["PROJECT", "TASK"]
        },
        userIds: filters.userIds,
        projectIds: filters.projectIds,
        taskIds: filters.taskIds,
        tagIds: filters.tagIds
      }
    });
  }

  async requestJson<T>(method: string, path: string, options: Omit<RequestJsonOptions, "method"> = {}): Promise<T> {
    const upperMethod = method.toUpperCase();
    const canRetry = upperMethod === "GET" || options.retryMutations === true;
    let attempt = 0;
    let lastError: ClockifyApiError | undefined;

    while (attempt < this.maxAttempts) {
      attempt += 1;
      try {
        return await this.requestJsonOnce<T>(upperMethod, path, options);
      } catch (error) {
        const normalized = normalizeClockifyError(error);
        lastError = normalized;
        if (!canRetry || !normalized.retryable || attempt >= this.maxAttempts) {
          throw normalized;
        }
        await delay(normalized.retryAfterMs ?? jitteredDelay(this.baseDelayMs, attempt));
      }
    }

    throw lastError ?? new ClockifyApiError({ code: "CLOCKIFY_UPSTREAM_ERROR", message: "Clockify request failed" });
  }

  static async paginateList<T>(
    requestPage: (request: PageRequest) => Promise<T[]>,
    options: PaginationOptions = {}
  ): Promise<T[]> {
    const pageSize = normalizePageSize(options.pageSize);
    const maxPages = options.maxPages ?? 100;
    const items: T[] = [];

    for (let page = 1; page <= maxPages; page += 1) {
      const pageItems = await requestPage({ page, pageSize });
      items.push(...pageItems);
      if (pageItems.length < pageSize) {
        return items;
      }
    }

    throw new ClockifyApiError({
      code: "CLOCKIFY_PAGINATION_LIMIT",
      message: `Clockify pagination exceeded ${maxPages} pages`,
      retryable: false
    });
  }

  private async paginateQuery<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined>,
    options: PaginationOptions
  ): Promise<T[]> {
    return ClockifyClient.paginateList(
      ({ page, pageSize }) =>
        this.requestJson<T[]>("GET", path, {
          query: { ...query, page, "page-size": pageSize }
        }),
      options
    );
  }

  private async requestJsonOnce<T>(method: string, path: string, options: Omit<RequestJsonOptions, "method">): Promise<T> {
    const url = new URL(`${(options.baseUrl ?? this.apiBaseUrl).replace(/\/$/, "")}/${path.replace(/^\//, "")}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.fetchImpl(url, {
      method,
      headers: {
        "X-Api-Key": this.apiKey,
        "content-type": "application/json"
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    if (!response.ok) {
      throw await responseToError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

export function normalizeClockifyError(error: unknown): ClockifyApiError {
  if (error instanceof ClockifyApiError) {
    return error;
  }

  return new ClockifyApiError({
    code: "CLOCKIFY_NETWORK_ERROR",
    message: "Clockify network request failed",
    retryable: true,
    raw: redactClockifySecrets(error)
  });
}

async function responseToError(response: Response): Promise<ClockifyApiError> {
  const raw = await parseResponseBody(response);
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  const code = errorCodeForStatus(response.status);
  return new ClockifyApiError({
    status: response.status,
    code,
    message: messageFromRaw(raw) ?? `Clockify request failed with status ${response.status}`,
    retryable: response.status === 429 || response.status >= 500,
    retryAfterMs,
    details: redactClockifySecrets(raw),
    raw: redactClockifySecrets(raw)
  });
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFromRaw(raw: unknown): string | undefined {
  if (raw && typeof raw === "object" && "message" in raw) {
    return String((raw as { message: unknown }).message).replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]");
  }
  if (typeof raw === "string") {
    return raw.replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]");
  }
  return undefined;
}

function normalizePageSize(pageSize = DEFAULT_PAGE_SIZE): number {
  return Math.min(Math.max(1, Math.trunc(pageSize)), MAX_PAGE_SIZE);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

function jitteredDelay(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * 2 ** Math.max(0, attempt - 1);
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}
