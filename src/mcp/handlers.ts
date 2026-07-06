import { requireScopes, type AccessTokenPayload } from "../auth/jwt.js";
import { ClockifyClient } from "../clockify/client.js";
import type { CredentialStore } from "../db/credential-store.js";
import { assertValidJsonSchemaValue } from "./schema-validation.js";
import { assertSafeToolResult, getToolDescriptor } from "./tools.js";

export type ToolResult = {
  structuredContent: Record<string, unknown>;
  content: Array<{ type: "text"; text: string }>;
  _meta?: Record<string, unknown>;
};

export type ClockifyClientLike = Partial<{
  [K in keyof ClockifyClient]: ClockifyClient[K];
}>;

export type CallClockifyToolInput = {
  name: string;
  arguments: Record<string, unknown>;
  token: AccessTokenPayload;
  credentialStore: CredentialStore;
  createClient?: (apiKey: string) => ClockifyClientLike;
};

export async function callClockifyTool(input: CallClockifyToolInput): Promise<ToolResult> {
  const descriptor = getToolDescriptor(input.name);
  assertValidJsonSchemaValue(descriptor.inputSchema, input.arguments, "arguments");
  requireScopes(input.token, descriptor.securitySchemes[0]?.scopes ?? []);

  if (input.name === "delete_time_entry") {
    assertDeleteConfirmation(input.arguments);
  }

  const apiKey = await input.credentialStore.decryptActiveByOwnerId({ ownerId: input.token.sub });
  const client = input.createClient ? input.createClient(apiKey) : new ClockifyClient({ apiKey });

  const result = await dispatchTool(input.name, input.arguments, client);
  assertSafeToolResult(result);
  assertValidJsonSchemaValue(descriptor.outputSchema, result.structuredContent, "structuredContent");
  return result;
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  client: ClockifyClientLike
): Promise<ToolResult> {
  switch (name) {
    case "get_clockify_profile": {
      const user = await callClient(client, "getProfile");
      const workspaces = await callClient(client, "listWorkspaces");
      return toolResult(
        { user, workspaces },
        `Loaded Clockify profile and ${Array.isArray(workspaces) ? workspaces.length : 0} workspaces.`
      );
    }
    case "search_clockify_entities": {
      const workspaceId = stringArg(args, "workspaceId");
      const entityType = stringArg(args, "entityType");
      const query = optionalStringArg(args, "query");
      const limit = optionalNumberArg(args, "limit");
      const options = limit ? { pageSize: limit } : {};
      const items =
        entityType === "project"
          ? await callClient(client, "searchProjects", workspaceId, query, options)
          : entityType === "task"
            ? await callClient(client, "searchTasks", workspaceId, stringArg(args, "projectId"), query, options)
            : entityType === "client"
              ? await callClient(client, "searchClients", workspaceId, query, options)
              : await callClient(client, "searchTags", workspaceId, query, options);
      return toolResult({ items }, `Found ${Array.isArray(items) ? items.length : 0} Clockify ${entityType} items.`);
    }
    case "list_time_entries": {
      const workspaceId = stringArg(args, "workspaceId");
      const entries = await callClient(
        client,
        "listTimeEntries",
        workspaceId,
        stringArg(args, "userId", "current"),
        {
          start: stringArg(args, "start"),
          end: stringArg(args, "end"),
          projectId: optionalStringArg(args, "projectId"),
          taskId: optionalStringArg(args, "taskId")
        },
        { pageSize: optionalNumberArg(args, "limit") }
      );
      const normalizedEntries = Array.isArray(entries) ? entries.map((entry) => normalizeTimeEntry(entry, workspaceId)) : [];
      return toolResult({ entries: normalizedEntries }, `Loaded ${normalizedEntries.length} time entries.`);
    }
    case "get_current_timer": {
      const entry = await callClient(client, "getCurrentTimer", stringArg(args, "workspaceId"), stringArg(args, "userId", "current"));
      return toolResult(
        { entry: entry ? normalizeTimeEntry(entry, stringArg(args, "workspaceId")) : null },
        entry ? "A Clockify timer is running." : "No Clockify timer is running."
      );
    }
    case "start_timer": {
      const entry = await callClient(client, "startTimer", stringArg(args, "workspaceId"), compactPayload(args));
      return toolResult({ entry: normalizeTimeEntry(entry, stringArg(args, "workspaceId")) }, "Started Clockify timer.");
    }
    case "stop_timer": {
      const entry = await callClient(client, "stopTimer", stringArg(args, "workspaceId"), stringArg(args, "userId", "current"), stringArg(args, "end"));
      return toolResult({ entry: normalizeTimeEntry(entry, stringArg(args, "workspaceId")) }, "Stopped Clockify timer.");
    }
    case "create_time_entry": {
      const entry = await callClient(client, "createTimeEntry", stringArg(args, "workspaceId"), compactPayload(args));
      return toolResult({ entry: normalizeTimeEntry(entry, stringArg(args, "workspaceId")) }, "Created Clockify time entry.");
    }
    case "update_time_entry": {
      const entry = await callClient(
        client,
        "updateTimeEntry",
        stringArg(args, "workspaceId"),
        stringArg(args, "timeEntryId"),
        compactPayload(args)
      );
      return toolResult({ entry: normalizeTimeEntry(entry, stringArg(args, "workspaceId")) }, "Updated Clockify time entry.");
    }
    case "delete_time_entry": {
      const timeEntryId = stringArg(args, "timeEntryId");
      await callClient(client, "deleteTimeEntry", stringArg(args, "workspaceId"), timeEntryId);
      return toolResult({ deleted: true, timeEntryId }, "Deleted Clockify time entry.");
    }
    case "summarize_time_report": {
      const report = await callClient(client, "getSummaryReport", stringArg(args, "workspaceId"), {
        dateRangeStart: stringArg(args, "dateRangeStart"),
        dateRangeEnd: stringArg(args, "dateRangeEnd"),
        projectIds: optionalStringArrayArg(args, "projectIds"),
        taskIds: optionalStringArrayArg(args, "taskIds"),
        tagIds: optionalStringArrayArg(args, "tagIds")
      });
      return toolResult(normalizeReport(report), "Summarized Clockify report.");
    }
    default:
      throw new Error(`Unsupported tool: ${name}`);
  }
}

function normalizeTimeEntry(entry: unknown, workspaceId: string): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;
  const interval = (raw.timeInterval && typeof raw.timeInterval === "object" ? raw.timeInterval : {}) as Record<
    string,
    unknown
  >;
  return removeUndefined({
    timeEntryId: raw.id,
    workspaceId,
    projectId: raw.projectId,
    taskId: raw.taskId,
    description: raw.description,
    start: interval.start,
    end: interval.end,
    durationSeconds: durationToSeconds(interval.duration),
    billable: raw.billable,
    tags: raw.tagIds
  });
}

function normalizeReport(report: unknown): Record<string, unknown> {
  if (!report || typeof report !== "object") {
    return { totalSeconds: 0, groups: [] };
  }
  const raw = report as Record<string, unknown>;
  const groups = Array.isArray(raw.groupOne) ? raw.groupOne : Array.isArray(raw.totals) ? raw.totals : [];
  const normalizedGroups = groups.map(normalizeReportGroup);
  return {
    totalSeconds: sumReportSeconds(normalizedGroups),
    groups: normalizedGroups
  };
}

function normalizeReportGroup(group: unknown): Record<string, unknown> {
  if (!group || typeof group !== "object") return {};
  const raw = group as Record<string, unknown>;
  const seconds = raw.durationSeconds ?? raw.totalSeconds ?? raw.totalTime;
  return removeUndefined({
    id: raw.id,
    name: raw.name,
    projectId: raw.projectId,
    clientId: raw.clientId,
    taskId: raw.taskId,
    userId: raw.userId,
    tagId: raw.tagId,
    durationSeconds: typeof seconds === "number" ? seconds : undefined,
    totalSeconds: typeof raw.totalSeconds === "number" ? raw.totalSeconds : undefined
  });
}

function sumReportSeconds(groups: Array<Record<string, unknown>>): number {
  return groups.reduce<number>((sum, group) => {
    const seconds = group.durationSeconds ?? group.totalSeconds;
    return sum + (typeof seconds === "number" ? seconds : 0);
  }, 0);
}

function durationToSeconds(duration: unknown): number | undefined {
  if (typeof duration !== "string") return undefined;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration);
  if (!match) return undefined;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function removeUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function assertDeleteConfirmation(args: Record<string, unknown>): void {
  const confirmation = args.confirmation;
  if (!confirmation || typeof confirmation !== "object") {
    throw new Error("delete_time_entry requires explicit confirmation.");
  }
  const typed = confirmation as Record<string, unknown>;
  if (
    typed.action !== "delete_time_entry" ||
    typed.workspaceId !== args.workspaceId ||
    typed.timeEntryId !== args.timeEntryId
  ) {
    throw new Error("delete_time_entry confirmation does not match the requested action.");
  }
}

async function callClient(client: ClockifyClientLike, method: string, ...args: unknown[]): Promise<unknown> {
  const fn = client[method as keyof ClockifyClientLike];
  if (typeof fn !== "function") {
    throw new Error(`Clockify client method is unavailable: ${method}`);
  }
  return (fn as (...methodArgs: unknown[]) => Promise<unknown>).apply(client, args);
}

function toolResult(structuredContent: Record<string, unknown>, text: string): ToolResult {
  return {
    structuredContent,
    content: [{ type: "text", text }]
  };
}

function stringArg(args: Record<string, unknown>, name: string, fallback?: string): string {
  const value = args[name] ?? fallback;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required string argument: ${name}`);
  }
  return value;
}

function optionalStringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumberArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  return typeof value === "number" ? value : undefined;
}

function optionalStringArrayArg(args: Record<string, unknown>, name: string): string[] | undefined {
  const value = args[name];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function compactPayload(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    ["start", "end", "description", "projectId", "taskId", "tagIds", "billable"]
      .map((key) => [key, args[key]])
      .filter(([, value]) => value !== undefined)
  );
}
