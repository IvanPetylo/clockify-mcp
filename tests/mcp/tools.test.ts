import { assertSafeToolResult, getToolDescriptor, listClockifyTools } from "../../src/mcp/tools.js";
import { assertValidJsonSchemaValue } from "../../src/mcp/schema-validation.js";

const expectedToolNames = [
  "get_clockify_profile",
  "search_clockify_entities",
  "list_time_entries",
  "get_current_timer",
  "start_timer",
  "stop_timer",
  "create_time_entry",
  "update_time_entry",
  "delete_time_entry",
  "summarize_time_report"
];

describe("Clockify MCP tool descriptors", () => {
  test("all expected v1 tool names exist and are unique", () => {
    const names = listClockifyTools().map((tool) => tool.name);
    expect(names).toEqual(expectedToolNames);
    expect(new Set(names).size).toBe(names.length);
  });

  test("each descriptor has schemas, auth, and annotations", () => {
    for (const tool of listClockifyTools()) {
      expect(tool.title).toEqual(expect.any(String));
      expect(tool.description).toEqual(expect.any(String));
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.outputSchema).toMatchObject({ type: "object" });
      expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: expect.any(Array) }]);
      expect(tool.annotations).toMatchObject({
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        openWorldHint: true
      });
    }
  });

  test("tool names and descriptions are marketplace-safe", () => {
    const actionVerbs = new Set(["get", "search", "list", "start", "stop", "create", "update", "delete", "summarize"]);
    const bannedDescriptionTerms = /\b(best|official|preferred|pick me|better than|only app)\b/i;

    for (const tool of listClockifyTools()) {
      const [verb] = tool.name.split("_");

      expect(tool.name).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
      expect(actionVerbs.has(verb ?? "")).toBe(true);
      expect(tool.description).toMatch(/^Use this when the user /);
      expect(tool.description).not.toMatch(bannedDescriptionTerms);
      expect(tool.description).not.toMatch(/ClockifyMCP/i);
    }
  });

  test("Apps SDK auth metadata mirrors MCP security schemes", () => {
    for (const tool of listClockifyTools()) {
      expect(tool._meta?.securitySchemes).toEqual(tool.securitySchemes);
      expect(tool.securitySchemes[0]?.scopes.length).toBeGreaterThan(0);
    }
  });

  test("read, write, and destructive annotations match v1 behavior", () => {
    const readTools = [
      "get_clockify_profile",
      "search_clockify_entities",
      "list_time_entries",
      "get_current_timer",
      "summarize_time_report"
    ];
    for (const name of readTools) {
      expect(getToolDescriptor(name).annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true
      });
    }

    for (const name of ["start_timer", "stop_timer", "create_time_entry", "update_time_entry"]) {
      expect(getToolDescriptor(name).annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false
      });
    }

    expect(getToolDescriptor("delete_time_entry").annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false
    });
  });

  test("delete_time_entry requires exact confirmation fields", () => {
    const descriptor = getToolDescriptor("delete_time_entry");
    expect(descriptor.inputSchema.required).toContain("confirmation");
    expect(descriptor.inputSchema.properties).toHaveProperty("confirmation");
    expect(descriptor.inputSchema.properties!.confirmation).toMatchObject({
      type: "object",
      required: ["action", "workspaceId", "timeEntryId"]
    });
  });

  test("get_current_timer output schema accepts a null current entry", () => {
    const descriptor = getToolDescriptor("get_current_timer");

    expect(() => assertValidJsonSchemaValue(descriptor.outputSchema, { entry: null })).not.toThrow();
  });

  test("invocation metadata strings are short enough for Apps SDK", () => {
    for (const tool of listClockifyTools()) {
      for (const [key, value] of Object.entries(tool._meta ?? {})) {
        if (key.includes("openai/toolInvocation") && typeof value === "string") {
          expect(value.length).toBeLessThanOrEqual(64);
        }
      }
    }
  });

  test("assertSafeToolResult rejects obvious secrets in tool result", () => {
    expect(() =>
      assertSafeToolResult({
        content: [{ type: "text", text: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456" }],
        structuredContent: { ok: true }
      })
    ).toThrow(/secret/i);
  });
});
