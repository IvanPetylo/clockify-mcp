export type JsonSchema = {
  type?: string | string[];
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  format?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  minLength?: number;
  description?: string;
};

export type ClockifyToolDescriptor = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  securitySchemes: Array<{ type: "oauth2"; scopes: string[] }>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: true;
    idempotentHint?: boolean;
  };
  _meta?: Record<string, unknown>;
};

const readScope = "clockify.read";
const writeScope = "clockify.time.write";
const deleteScope = "clockify.time.delete";

const idSchema = (description: string): JsonSchema => ({
  type: "string",
  minLength: 1,
  description
});

const dateTimeSchema = (description: string): JsonSchema => ({
  type: "string",
  format: "date-time",
  description
});

const entitySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    archived: { type: "boolean" },
    projectId: { type: "string" },
    clientId: { type: "string" }
  }
};

const timeEntrySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["timeEntryId", "workspaceId", "start"],
  properties: {
    timeEntryId: { type: "string" },
    workspaceId: { type: "string" },
    projectId: { type: "string" },
    taskId: { type: "string" },
    description: { type: "string", maxLength: 3000 },
    start: { type: "string", format: "date-time" },
    end: { type: "string", format: "date-time" },
    durationSeconds: { type: "number", minimum: 0 },
    billable: { type: "boolean" },
    tags: { type: "array", items: { type: "string" } }
  }
};

const emptyInput: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {}
};

const workspaceInput: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["workspaceId"],
  properties: {
    workspaceId: idSchema("Clockify workspace ID.")
  }
};

function descriptor(args: {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  scopes: string[];
  readOnly: boolean;
  destructive?: boolean;
  invoking: string;
  invoked: string;
}): ClockifyToolDescriptor {
  return {
    name: args.name,
    title: args.title,
    description: args.description,
    inputSchema: args.inputSchema,
    outputSchema: args.outputSchema,
    securitySchemes: [{ type: "oauth2", scopes: args.scopes }],
    annotations: {
      readOnlyHint: args.readOnly,
      destructiveHint: args.destructive ?? false,
      openWorldHint: true,
      idempotentHint: args.readOnly
    },
    _meta: {
      securitySchemes: [{ type: "oauth2", scopes: args.scopes }],
      "openai/toolInvocation/invoking": args.invoking,
      "openai/toolInvocation/invoked": args.invoked
    }
  };
}

const tools: ClockifyToolDescriptor[] = [
  descriptor({
    name: "get_clockify_profile",
    title: "Get Clockify profile",
    description: "Use this when the user needs their Clockify identity and available workspaces.",
    inputSchema: emptyInput,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["user", "workspaces"],
      properties: {
        user: {
          type: "object",
          additionalProperties: false,
          required: ["id", "name", "email"],
          properties: { id: { type: "string" }, name: { type: "string" }, email: { type: "string" } }
        },
        workspaces: { type: "array", items: entitySchema }
      }
    },
    scopes: [readScope],
    readOnly: true,
    invoking: "Loading Clockify profile",
    invoked: "Loaded Clockify profile"
  }),
  descriptor({
    name: "search_clockify_entities",
    title: "Search Clockify entities",
    description: "Use this when the user needs Clockify projects, tasks, clients, or tags by name.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["workspaceId", "entityType"],
      properties: {
        workspaceId: idSchema("Clockify workspace ID."),
        entityType: { type: "string", enum: ["project", "task", "client", "tag"] },
        projectId: idSchema("Required when entityType is task."),
        query: { type: "string", maxLength: 200 },
        limit: { type: "number", minimum: 1, maximum: 200 }
      }
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: { items: { type: "array", items: entitySchema } }
    },
    scopes: [readScope],
    readOnly: true,
    invoking: "Searching Clockify",
    invoked: "Searched Clockify"
  }),
  descriptor({
    name: "list_time_entries",
    title: "List time entries",
    description: "Use this when the user needs their own Clockify time entries for a date range.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["workspaceId", "start", "end"],
      properties: {
        workspaceId: idSchema("Clockify workspace ID."),
        start: dateTimeSchema("Inclusive range start in UTC."),
        end: dateTimeSchema("Exclusive range end in UTC."),
        projectId: idSchema("Optional project filter."),
        taskId: idSchema("Optional task filter."),
        limit: { type: "number", minimum: 1, maximum: 200 }
      }
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entries"],
      properties: { entries: { type: "array", items: timeEntrySchema } }
    },
    scopes: [readScope],
    readOnly: true,
    invoking: "Loading time entries",
    invoked: "Loaded time entries"
  }),
  descriptor({
    name: "get_current_timer",
    title: "Get current timer",
    description: "Use this when the user asks whether a Clockify timer is currently running.",
    inputSchema: workspaceInput,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entry"],
      properties: { entry: { oneOf: [timeEntrySchema, { type: "null" }], description: "Current timer entry, or null." } }
    },
    scopes: [readScope],
    readOnly: true,
    invoking: "Checking current timer",
    invoked: "Checked current timer"
  }),
  descriptor({
    name: "start_timer",
    title: "Start timer",
    description: "Use this when the user asks to start a personal Clockify timer.",
    inputSchema: timeMutationInput(["workspaceId", "start"]),
    outputSchema: timeMutationOutput(),
    scopes: [writeScope],
    readOnly: false,
    invoking: "Starting timer",
    invoked: "Started timer"
  }),
  descriptor({
    name: "stop_timer",
    title: "Stop timer",
    description: "Use this when the user asks to stop their current personal Clockify timer.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["workspaceId", "end"],
      properties: {
        workspaceId: idSchema("Clockify workspace ID."),
        end: dateTimeSchema("Timer end timestamp in UTC.")
      }
    },
    outputSchema: timeMutationOutput(),
    scopes: [writeScope],
    readOnly: false,
    invoking: "Stopping timer",
    invoked: "Stopped timer"
  }),
  descriptor({
    name: "create_time_entry",
    title: "Create time entry",
    description: "Use this when the user asks to create a completed personal Clockify time entry.",
    inputSchema: timeMutationInput(["workspaceId", "start", "end"]),
    outputSchema: timeMutationOutput(),
    scopes: [writeScope],
    readOnly: false,
    invoking: "Creating time entry",
    invoked: "Created time entry"
  }),
  descriptor({
    name: "update_time_entry",
    title: "Update time entry",
    description: "Use this when the user asks to update one of their own Clockify time entries.",
    inputSchema: timeMutationInput(["workspaceId", "timeEntryId", "start"]),
    outputSchema: timeMutationOutput(),
    scopes: [writeScope],
    readOnly: false,
    invoking: "Updating time entry",
    invoked: "Updated time entry"
  }),
  descriptor({
    name: "delete_time_entry",
    title: "Delete time entry",
    description: "Use this when the user explicitly confirms deleting one of their own Clockify time entries.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["workspaceId", "timeEntryId", "confirmation"],
      properties: {
        workspaceId: idSchema("Clockify workspace ID."),
        timeEntryId: idSchema("Clockify time entry ID."),
        confirmation: {
          type: "object",
          additionalProperties: false,
          required: ["action", "workspaceId", "timeEntryId"],
          properties: {
            action: { type: "string", enum: ["delete_time_entry"] },
            workspaceId: idSchema("Workspace ID repeated exactly for confirmation."),
            timeEntryId: idSchema("Time entry ID repeated exactly for confirmation.")
          }
        }
      }
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["deleted", "timeEntryId"],
      properties: { deleted: { type: "boolean" }, timeEntryId: { type: "string" } }
    },
    scopes: [deleteScope],
    readOnly: false,
    destructive: true,
    invoking: "Deleting time entry",
    invoked: "Deleted time entry"
  }),
  descriptor({
    name: "summarize_time_report",
    title: "Summarize time report",
    description: "Use this when the user needs a personal Clockify time summary for a bounded date range.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["workspaceId", "dateRangeStart", "dateRangeEnd"],
      properties: {
        workspaceId: idSchema("Clockify workspace ID."),
        dateRangeStart: dateTimeSchema("Report start in UTC."),
        dateRangeEnd: dateTimeSchema("Report end in UTC."),
        projectIds: { type: "array", items: { type: "string" } },
        taskIds: { type: "array", items: { type: "string" } },
        tagIds: { type: "array", items: { type: "string" } },
        limit: { type: "number", minimum: 1, maximum: 200 }
      }
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["totalSeconds", "groups"],
      properties: {
        totalSeconds: { type: "number", minimum: 0 },
        groups: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              projectId: { type: "string" },
              clientId: { type: "string" },
              taskId: { type: "string" },
              userId: { type: "string" },
              tagId: { type: "string" },
              durationSeconds: { type: "number", minimum: 0 },
              totalSeconds: { type: "number", minimum: 0 }
            }
          }
        }
      }
    },
    scopes: [readScope],
    readOnly: true,
    invoking: "Summarizing report",
    invoked: "Summarized report"
  })
];

export function listClockifyTools(): ClockifyToolDescriptor[] {
  return tools;
}

export function getToolDescriptor(name: string): ClockifyToolDescriptor {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Unknown Clockify tool: ${name}`);
  }
  return tool;
}

export function assertSafeToolResult(result: unknown): void {
  const serialized = JSON.stringify(result);
  if (/(authorization\s*:|bearer\s+|x-api-key|api[_-]?key|refresh[_-]?token|access[_-]?token)/i.test(serialized)) {
    throw new Error("Tool result contains a secret-like value");
  }
  if (/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/.test(serialized)) {
    throw new Error("Tool result contains a token-like value");
  }
}

function timeMutationInput(required: string[]): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties: {
      workspaceId: idSchema("Clockify workspace ID."),
      timeEntryId: idSchema("Clockify time entry ID."),
      start: dateTimeSchema("Entry start timestamp in UTC."),
      end: dateTimeSchema("Entry end timestamp in UTC."),
      description: { type: "string", maxLength: 3000 },
      projectId: idSchema("Optional project ID."),
      taskId: idSchema("Optional task ID."),
      tagIds: { type: "array", items: { type: "string" } },
      billable: { type: "boolean" }
    }
  };
}

function timeMutationOutput(): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["entry"],
    properties: { entry: timeEntrySchema }
  };
}
