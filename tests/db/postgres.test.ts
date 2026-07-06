import { createPgPoolFromEnv } from "../../src/db/postgres.js";

describe("Postgres pool configuration", () => {
  test("uses certificate verification when PGSSLMODE is verify-full", async () => {
    const pool = createPgPoolFromEnv({
      DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
      PGSSLMODE: "verify-full"
    });

    expect(pool.options.ssl).toEqual({ rejectUnauthorized: true });
    await pool.end();
  });

  test("keeps require mode available for managed databases with custom certificates", async () => {
    const pool = createPgPoolFromEnv({
      DATABASE_URL: "postgres://postgres:postgres@example.com:5432/clockify_mcp",
      PGSSLMODE: "require"
    });

    expect(pool.options.ssl).toEqual({ rejectUnauthorized: false });
    await pool.end();
  });
});
