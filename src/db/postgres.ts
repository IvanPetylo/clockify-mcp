import { Pool } from "pg";

export type QueryResult<T = unknown> = {
  rows: T[];
  rowCount: number | null;
};

export type Queryable = {
  query<T = unknown>(sql: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
};

export type TransactionClient = Queryable & {
  release(): void;
};

export type TransactionalQueryable = Queryable & {
  connect(): Promise<TransactionClient>;
};

export type PgPoolEnv = Partial<Pick<NodeJS.ProcessEnv, "DATABASE_URL" | "PGSSLMODE">>;

export function createPgPoolFromEnv(env: PgPoolEnv = process.env): Pool {
  return new Pool({
    connectionString: env.DATABASE_URL,
    ssl: postgresSslOptions(env.PGSSLMODE)
  });
}

function postgresSslOptions(mode: PgPoolEnv["PGSSLMODE"]): { rejectUnauthorized: boolean } | undefined {
  if (mode === "verify-full") {
    return { rejectUnauthorized: true };
  }
  if (mode === "require") {
    return { rejectUnauthorized: false };
  }
  return undefined;
}
