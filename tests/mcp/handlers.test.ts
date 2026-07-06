import { InMemoryCredentialStore } from "../../src/db/credential-store.js";
import { createCredentialCipher } from "../../src/auth/crypto.js";
import { callClockifyTool, type ClockifyClientLike } from "../../src/mcp/handlers.js";
import { assertValidJsonSchemaValue } from "../../src/mcp/schema-validation.js";
import { assertSafeToolResult, getToolDescriptor } from "../../src/mcp/tools.js";
import type { AccessTokenPayload } from "../../src/auth/jwt.js";

const token: AccessTokenPayload = {
  sub: "owner-1",
  clientId: "chatgpt",
  scopes: ["clockify.read", "clockify.time.write", "clockify.time.delete"],
  exp: Math.floor(Date.now() / 1000) + 60
};

function makeStore() {
  const cipher = createCredentialCipher({
    activeKeyVersion: "v1",
    keys: { v1: Buffer.alloc(32, 7).toString("base64") }
  });
  const credentialStore = new InMemoryCredentialStore({ cipher });
  credentialStore.save({ ownerId: "owner-1", plaintext: "clockify-api-key" });
  return { credentialStore };
}

function demoEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    description: "Deep work",
    projectId: "p1",
    taskId: "t1",
    billable: true,
    timeInterval: {
      start: "2026-07-03T10:00:00Z",
      end: "2026-07-03T11:30:00Z",
      duration: "PT1H30M"
    },
    tagIds: ["tag1"],
    ...overrides
  };
}

function expectSafeDeclaredOutput(name: string, structuredContent: Record<string, unknown>): void {
  assertSafeToolResult({ structuredContent, content: [{ type: "text", text: "fixture" }] });
  assertValidJsonSchemaValue(getToolDescriptor(name).outputSchema, structuredContent, "structuredContent");
}

describe("Clockify MCP handlers", () => {
  test.each([
    {
      caseName: "get_clockify_profile",
      name: "get_clockify_profile",
      args: {},
      client: {
        getProfile: vi.fn(async () => ({ id: "u1", name: "Ada", email: "ada@example.com" })),
        listWorkspaces: vi.fn(async () => [{ id: "w1", name: "Personal", archived: false }])
      }
    },
    {
      caseName: "search_clockify_entities project branch",
      name: "search_clockify_entities",
      args: { workspaceId: "w1", entityType: "project", query: "Portal", limit: 10 },
      client: {
        searchProjects: vi.fn(async () => [{ id: "p1", name: "Client Portal", archived: false, clientId: "c1" }])
      }
    },
    {
      caseName: "search_clockify_entities task branch",
      name: "search_clockify_entities",
      args: { workspaceId: "w1", entityType: "task", projectId: "p1", query: "Review", limit: 10 },
      client: {
        searchTasks: vi.fn(async () => [{ id: "t1", name: "Review", archived: false, projectId: "p1" }])
      }
    },
    {
      caseName: "search_clockify_entities client branch",
      name: "search_clockify_entities",
      args: { workspaceId: "w1", entityType: "client", query: "SoftPeak", limit: 10 },
      client: {
        searchClients: vi.fn(async () => [{ id: "c1", name: "SoftPeak", archived: false }])
      }
    },
    {
      caseName: "search_clockify_entities tag branch",
      name: "search_clockify_entities",
      args: { workspaceId: "w1", entityType: "tag", query: "Review", limit: 10 },
      client: {
        searchTags: vi.fn(async () => [{ id: "tag1", name: "Review", archived: false }])
      }
    },
    {
      caseName: "list_time_entries",
      name: "list_time_entries",
      args: { workspaceId: "w1", start: "2026-07-03T00:00:00Z", end: "2026-07-04T00:00:00Z" },
      client: {
        listTimeEntries: vi.fn(async () => [demoEntry()])
      }
    },
    {
      caseName: "get_current_timer",
      name: "get_current_timer",
      args: { workspaceId: "w1" },
      client: {
        getCurrentTimer: vi.fn(async () => demoEntry({ timeInterval: { start: "2026-07-03T12:00:00Z" } }))
      }
    },
    {
      caseName: "start_timer",
      name: "start_timer",
      args: { workspaceId: "w1", start: "2026-07-03T12:00:00Z", description: "Planning" },
      client: {
        startTimer: vi.fn(async () => demoEntry({ timeInterval: { start: "2026-07-03T12:00:00Z" } }))
      }
    },
    {
      caseName: "stop_timer",
      name: "stop_timer",
      args: { workspaceId: "w1", end: "2026-07-03T12:30:00Z" },
      client: {
        stopTimer: vi.fn(async () => demoEntry())
      }
    },
    {
      caseName: "create_time_entry",
      name: "create_time_entry",
      args: { workspaceId: "w1", start: "2026-07-03T10:00:00Z", end: "2026-07-03T11:30:00Z" },
      client: {
        createTimeEntry: vi.fn(async () => demoEntry())
      }
    },
    {
      caseName: "update_time_entry",
      name: "update_time_entry",
      args: { workspaceId: "w1", timeEntryId: "e1", start: "2026-07-03T10:00:00Z", description: "Updated" },
      client: {
        updateTimeEntry: vi.fn(async () => demoEntry({ description: "Updated" }))
      }
    },
    {
      caseName: "delete_time_entry",
      name: "delete_time_entry",
      args: {
        workspaceId: "w1",
        timeEntryId: "e1",
        confirmation: { action: "delete_time_entry", workspaceId: "w1", timeEntryId: "e1" }
      },
      client: {
        deleteTimeEntry: vi.fn(async () => undefined)
      }
    },
    {
      caseName: "summarize_time_report",
      name: "summarize_time_report",
      args: { workspaceId: "w1", dateRangeStart: "2026-07-01T00:00:00Z", dateRangeEnd: "2026-07-08T00:00:00Z" },
      client: {
        getSummaryReport: vi.fn(async () => ({ groupOne: [{ name: "Client Portal", durationSeconds: 5400 }] }))
      }
    }
  ])("$caseName returns safe structured content matching its declared output schema", async ({ name, args, client }) => {
    const { credentialStore } = makeStore();

    const result = await callClockifyTool({
      name,
      arguments: args,
      token,
      credentialStore,
      createClient: vi.fn(() => client)
    });

    expectSafeDeclaredOutput(name, result.structuredContent);
    expect(JSON.stringify(result)).not.toContain("clockify-api-key");
  });

  test("get_clockify_profile requires read scope and returns safe profile content", async () => {
    const { credentialStore } = makeStore();
    const client = {
      getProfile: vi.fn(async () => ({ id: "u1", name: "Ada", email: "ada@example.com" })),
      listWorkspaces: vi.fn(async () => [{ id: "w1", name: "Personal" }])
    };

    const result = await callClockifyTool({
      name: "get_clockify_profile",
      arguments: {},
      token,
      credentialStore,
      createClient: vi.fn(() => client)
    });

    expect(client.getProfile).toHaveBeenCalledTimes(1);
    expect(result.structuredContent).toEqual({
      user: { id: "u1", name: "Ada", email: "ada@example.com" },
      workspaces: [{ id: "w1", name: "Personal" }]
    });
    expect(JSON.stringify(result)).not.toContain("clockify-api-key");
  });

  test("start_timer rejects token without write scope before Clockify call", async () => {
    const { credentialStore } = makeStore();
    const createClient = vi.fn();

    await expect(
      callClockifyTool({
        name: "start_timer",
        arguments: { workspaceId: "w1", start: "2026-07-03T10:00:00Z" },
      token: { ...token, scopes: ["clockify.read"] },
      credentialStore,
      createClient
      })
    ).rejects.toThrow(/missing/i);
    expect(createClient).not.toHaveBeenCalled();
  });

  test("start_timer rejects invalid arguments before decrypting credentials or creating a client", async () => {
    const { credentialStore } = makeStore();
    const decryptActive = vi.spyOn(credentialStore, "decryptActiveByOwnerId");
    const createClient = vi.fn();

    await expect(
      callClockifyTool({
        name: "start_timer",
        arguments: { start: "2026-07-03T10:00:00Z" },
        token,
        credentialStore,
        createClient
      })
    ).rejects.toThrow(/workspaceId/i);
    expect(decryptActive).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  test("search_clockify_entities rejects invalid entityType enum before creating a client", async () => {
    const { credentialStore } = makeStore();
    const decryptActive = vi.spyOn(credentialStore, "decryptActiveByOwnerId");
    const createClient = vi.fn();

    await expect(
      callClockifyTool({
        name: "search_clockify_entities",
        arguments: { workspaceId: "w1", entityType: "invoice" },
        token,
        credentialStore,
        createClient
      })
    ).rejects.toThrow(/entityType/i);
    expect(decryptActive).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  test("delete_time_entry rejects mismatched confirmation", async () => {
    const { credentialStore } = makeStore();
    const createClient = vi.fn();

    await expect(
      callClockifyTool({
        name: "delete_time_entry",
        arguments: {
          workspaceId: "w1",
          timeEntryId: "e1",
          confirmation: { action: "delete_time_entry", workspaceId: "w1", timeEntryId: "other" }
      },
      token,
      credentialStore,
      createClient
      })
    ).rejects.toThrow(/confirmation/i);
    expect(createClient).not.toHaveBeenCalled();
  });

  test("delete_time_entry executes confirmed deletion once", async () => {
    const { credentialStore } = makeStore();
    const client = {
      deleteTimeEntry: vi.fn(async () => undefined)
    };

    const result = await callClockifyTool({
      name: "delete_time_entry",
      arguments: {
        workspaceId: "w1",
        timeEntryId: "e1",
        confirmation: { action: "delete_time_entry", workspaceId: "w1", timeEntryId: "e1" }
      },
      token,
      credentialStore,
      createClient: vi.fn(() => client)
    });

    expect(client.deleteTimeEntry).toHaveBeenCalledTimes(1);
    expect(client.deleteTimeEntry).toHaveBeenCalledWith("w1", "e1");
    expect(result.structuredContent).toEqual({ deleted: true, timeEntryId: "e1" });
  });

  test("create_time_entry normalizes raw Clockify entry to declared output shape", async () => {
    const { credentialStore } = makeStore();
    const client = {
      createTimeEntry: vi.fn(async () => ({
        id: "e1",
        description: "Deep work",
        projectId: "p1",
        taskId: "t1",
        billable: true,
        timeInterval: {
          start: "2026-07-03T10:00:00Z",
          end: "2026-07-03T11:30:00Z",
          duration: "PT1H30M"
        },
        tagIds: ["tag1"]
      }))
    };

    const result = await callClockifyTool({
      name: "create_time_entry",
      arguments: {
        workspaceId: "w1",
        start: "2026-07-03T10:00:00Z",
        end: "2026-07-03T11:30:00Z",
        description: "Deep work"
      },
      token,
      credentialStore,
      createClient: vi.fn(() => client)
    });

    expect(result.structuredContent.entry).toEqual({
      timeEntryId: "e1",
      workspaceId: "w1",
      projectId: "p1",
      taskId: "t1",
      description: "Deep work",
      start: "2026-07-03T10:00:00Z",
      end: "2026-07-03T11:30:00Z",
      durationSeconds: 5400,
      billable: true,
      tags: ["tag1"]
    });
  });

  test("create_time_entry rejects malformed structured output from Clockify response", async () => {
    const { credentialStore } = makeStore();
    const client = {
      createTimeEntry: vi.fn(async () => ({ id: "e1" }))
    };

    await expect(
      callClockifyTool({
        name: "create_time_entry",
        arguments: {
          workspaceId: "w1",
          start: "2026-07-03T10:00:00Z",
          end: "2026-07-03T11:30:00Z"
        },
        token,
        credentialStore,
        createClient: vi.fn(() => client as unknown as ClockifyClientLike)
      })
    ).rejects.toThrow(/entry\.start/i);
  });

  test("create_time_entry rejects Clockify entries missing required IDs", async () => {
    const { credentialStore } = makeStore();
    const client = {
      createTimeEntry: vi.fn(async () => demoEntry({ id: undefined }))
    };

    await expect(
      callClockifyTool({
        name: "create_time_entry",
        arguments: {
          workspaceId: "w1",
          start: "2026-07-03T10:00:00Z",
          end: "2026-07-03T11:30:00Z"
        },
        token,
        credentialStore,
        createClient: vi.fn(() => client as unknown as ClockifyClientLike)
      })
    ).rejects.toThrow(/entry\.timeEntryId/i);
  });

  test("get_clockify_profile rejects unexpected debug fields before returning tool output", async () => {
    const { credentialStore } = makeStore();
    const client = {
      getProfile: vi.fn(async () => ({ id: "u1", name: "Ada", email: "ada@example.com", debug: { traceId: "trace-1" } })),
      listWorkspaces: vi.fn(async () => [{ id: "w1", name: "Personal" }])
    };

    await expect(
      callClockifyTool({
        name: "get_clockify_profile",
        arguments: {},
        token,
        credentialStore,
        createClient: vi.fn(() => client)
      })
    ).rejects.toThrow(/debug/i);
  });

  test("search_clockify_entities rejects unexpected debug fields before returning tool output", async () => {
    const { credentialStore } = makeStore();
    const client = {
      searchProjects: vi.fn(async () => [{ id: "p1", name: "Client Portal", debug: { traceId: "trace-1" } }])
    };

    await expect(
      callClockifyTool({
        name: "search_clockify_entities",
        arguments: { workspaceId: "w1", entityType: "project" },
        token,
        credentialStore,
        createClient: vi.fn(() => client)
      })
    ).rejects.toThrow(/debug/i);
  });

  test("summarize_time_report strips unexpected debug fields from upstream groups", async () => {
    const { credentialStore } = makeStore();
    const client = {
      getSummaryReport: vi.fn(async () => ({
        groupOne: [
          {
            name: "Project A",
            durationSeconds: 60,
            debug: { traceId: "trace-1", internal: "scheduler-plan" }
          }
        ]
      }))
    };

    const result = await callClockifyTool({
      name: "summarize_time_report",
      arguments: { workspaceId: "w1", dateRangeStart: "2026-07-01T00:00:00Z", dateRangeEnd: "2026-07-02T00:00:00Z" },
      token,
      credentialStore,
      createClient: vi.fn(() => client)
    });

    expect(result.structuredContent).toEqual({
      totalSeconds: 60,
      groups: [{ name: "Project A", durationSeconds: 60 }]
    });
    expect(JSON.stringify(result)).not.toContain("trace-1");
    expectSafeDeclaredOutput("summarize_time_report", result.structuredContent);
  });

  test("get_clockify_profile rejects workspaces missing required IDs", async () => {
    const { credentialStore } = makeStore();
    const client = {
      getProfile: vi.fn(async () => ({ id: "u1", name: "Ada", email: "ada@example.com" })),
      listWorkspaces: vi.fn(async () => [{ name: "Personal" }])
    };

    await expect(
      callClockifyTool({
        name: "get_clockify_profile",
        arguments: {},
        token,
        credentialStore,
        createClient: vi.fn(() => client as unknown as ClockifyClientLike)
      })
    ).rejects.toThrow(/workspaces\[0\]\.id/i);
  });

  test("start_timer rejects Clockify entries missing required IDs", async () => {
    const { credentialStore } = makeStore();
    const client = {
      startTimer: vi.fn(async () => demoEntry({ id: undefined, timeInterval: { start: "2026-07-03T12:00:00Z" } }))
    };

    await expect(
      callClockifyTool({
        name: "start_timer",
        arguments: { workspaceId: "w1", start: "2026-07-03T12:00:00Z" },
        token,
        credentialStore,
        createClient: vi.fn(() => client as unknown as ClockifyClientLike)
      })
    ).rejects.toThrow(/entry\.timeEntryId/i);
  });

  test("get_clockify_profile rejects bearer-like values from upstream payloads", async () => {
    const { credentialStore } = makeStore();
    const client = {
      getProfile: vi.fn(async () => ({ id: "u1", name: "Bearer abcdefghijklmnopqrstuvwxyz123456", email: "ada@example.com" })),
      listWorkspaces: vi.fn(async () => [{ id: "w1", name: "Personal" }])
    };

    await expect(
      callClockifyTool({
        name: "get_clockify_profile",
        arguments: {},
        token,
        credentialStore,
        createClient: vi.fn(() => client)
      })
    ).rejects.toThrow(/secret-like/i);
  });

  test("get_clockify_profile rejects JWT-like values from upstream payloads", async () => {
    const { credentialStore } = makeStore();
    const client = {
      getProfile: vi.fn(async () => ({
        id: "u1",
        name: "Ada",
        email: "aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccccc"
      })),
      listWorkspaces: vi.fn(async () => [{ id: "w1", name: "Personal" }])
    };

    await expect(
      callClockifyTool({
        name: "get_clockify_profile",
        arguments: {},
        token,
        credentialStore,
        createClient: vi.fn(() => client)
      })
    ).rejects.toThrow(/token-like/i);
  });

  test("search_clockify_entities rejects API-key-like values from upstream payloads", async () => {
    const { credentialStore } = makeStore();
    const client = {
      searchProjects: vi.fn(async () => [{ id: "p1", name: "x-api-key: secret-project-key", archived: false }])
    };

    await expect(
      callClockifyTool({
        name: "search_clockify_entities",
        arguments: { workspaceId: "w1", entityType: "project" },
        token,
        credentialStore,
        createClient: vi.fn(() => client)
      })
    ).rejects.toThrow(/secret-like/i);
  });

  test("get_current_timer accepts a null current entry result", async () => {
    const { credentialStore } = makeStore();
    const client = {
      getCurrentTimer: vi.fn(async () => null)
    };

    const result = await callClockifyTool({
      name: "get_current_timer",
      arguments: { workspaceId: "w1" },
      token,
      credentialStore,
      createClient: vi.fn(() => client)
    });

    expect(client.getCurrentTimer).toHaveBeenCalledWith("w1", "current");
    expect(result.structuredContent).toEqual({ entry: null });
  });
});
