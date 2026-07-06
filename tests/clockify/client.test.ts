import { ClockifyApiError } from "../../src/clockify/errors.js";
import { ClockifyClient } from "../../src/clockify/client.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init
  });
}

describe("ClockifyClient", () => {
  test("getProfile sends X-Api-Key header and returns normalized user profile", async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      expect(String(input)).toBe("https://api.clockify.me/api/v1/user");
      expect(init?.headers).toMatchObject({ "X-Api-Key": "test-clockify-key" });
      return jsonResponse({ id: "u1", name: "Ada", email: "ada@example.com" });
    });

    const client = new ClockifyClient({ apiKey: "test-clockify-key", fetchImpl });
    await expect(client.getProfile()).resolves.toEqual({ id: "u1", name: "Ada", email: "ada@example.com" });
  });

  test("paginateList starts at page 1 and stops when page length is less than pageSize", async () => {
    const pages: number[] = [];
    const result = await ClockifyClient.paginateList(
      async ({ page, pageSize }) => {
        pages.push(page);
        return page === 1
          ? Array.from({ length: pageSize }, (_, index) => `item-${index}`)
          : ["last"];
      },
      { pageSize: 3 }
    );

    expect(pages).toEqual([1, 2]);
    expect(result).toEqual(["item-0", "item-1", "item-2", "last"]);
  });

  test("paginateList caps requested pageSize at 200", async () => {
    const pageSizes: number[] = [];
    await ClockifyClient.paginateList(
      async ({ pageSize }) => {
        pageSizes.push(pageSize);
        return [];
      },
      { pageSize: 5000 }
    );

    expect(pageSizes).toEqual([200]);
  });

  test("paginateList throws CLOCKIFY_PAGINATION_LIMIT when maxPages is exceeded", async () => {
    await expect(
      ClockifyClient.paginateList(async () => ["item"], { pageSize: 1, maxPages: 1 })
    ).rejects.toMatchObject({ code: "CLOCKIFY_PAGINATION_LIMIT" });
  });

  test("requestJson normalizes 401 to CLOCKIFY_AUTH_ERROR without exposing the API key", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: "invalid key abcdefghijklmnopqrstuvwxyz123456" }, { status: 401 })
    );
    const client = new ClockifyClient({ apiKey: "abcdefghijklmnopqrstuvwxyz123456", fetchImpl });

    await expect(client.getProfile()).rejects.toMatchObject({
      code: "CLOCKIFY_AUTH_ERROR",
      status: 401,
      retryable: false
    });

    try {
      await client.getProfile();
    } catch (error) {
      expect(error).toBeInstanceOf(ClockifyApiError);
      expect(JSON.stringify(error)).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    }
  });

  test("requestJson retries idempotent GET after 429 and respects retry-after", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ message: "Too many requests" }, { status: 429, headers: { "retry-after": "0" } })
      )
      .mockResolvedValueOnce(jsonResponse({ id: "u1", name: "Ada", email: "ada@example.com" }));

    const client = new ClockifyClient({
      apiKey: "key",
      fetchImpl,
      retry: { maxAttempts: 2, baseDelayMs: 0 }
    });

    await expect(client.getProfile()).resolves.toMatchObject({ id: "u1" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("requestJson does not retry POST by default after 429", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "Too many requests" }, { status: 429 }));
    const client = new ClockifyClient({ apiKey: "key", fetchImpl, retry: { maxAttempts: 3, baseDelayMs: 0 } });

    await expect(client.startTimer("w1", { start: "2026-07-03T10:00:00Z" })).rejects.toMatchObject({
      code: "CLOCKIFY_RATE_LIMITED"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
