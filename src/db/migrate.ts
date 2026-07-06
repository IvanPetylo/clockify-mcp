import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createPgPoolFromEnv } from "./postgres.js";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run database migrations.");
  }

  const migrationsDir = path.join(process.cwd(), "src", "db", "migrations");
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  if (files.length === 0) {
    throw new Error(`No SQL migrations found in ${migrationsDir}.`);
  }

  const pool = createPgPoolFromEnv();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      await client.query(sql);
      console.log(`Applied migration: ${file}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
