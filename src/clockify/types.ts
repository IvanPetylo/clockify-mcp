export type ClockifyWorkspace = {
  id: string;
  name: string;
  hourlyRate?: unknown;
  memberships?: unknown[];
};

export type ClockifyUser = {
  id: string;
  name: string;
  email: string;
  activeWorkspace?: string;
  defaultWorkspace?: string;
};

export type ClockifyEntity = {
  id: string;
  name: string;
  archived?: boolean;
  projectId?: string;
  clientId?: string;
};

export type ClockifyTimeEntry = {
  id: string;
  description?: string;
  userId?: string;
  projectId?: string;
  taskId?: string;
  tagIds?: string[];
  timeInterval: {
    start: string;
    end?: string | null;
    duration?: string | null;
  };
};

export type ClockifyReportSummary = {
  totals?: unknown[];
  groupOne?: unknown[];
  groupTwo?: unknown[];
  timeentries?: unknown[];
};

export type ClockifyClientConfig = {
  apiKey: string;
  apiBaseUrl?: string;
  reportsBaseUrl?: string;
  fetchImpl?: typeof fetch;
  retry?: {
    maxAttempts?: number;
    baseDelayMs?: number;
  };
};

export type PaginationOptions = {
  pageSize?: number;
  maxPages?: number;
};

export type TimeEntryFilters = {
  start?: string;
  end?: string;
  projectId?: string;
  taskId?: string;
  tags?: string[];
  inProgress?: boolean;
};

export type StartTimerPayload = {
  start: string;
  description?: string;
  projectId?: string;
  taskId?: string;
  tagIds?: string[];
};

export type TimeEntryPayload = StartTimerPayload & {
  end?: string;
};

export type SummaryReportFilters = {
  dateRangeStart: string;
  dateRangeEnd: string;
  userIds?: string[];
  projectIds?: string[];
  taskIds?: string[];
  tagIds?: string[];
};
