import "server-only";

import { Pool } from "pg";

const globalForPostgres = globalThis as typeof globalThis & {
  quincailleriePostgresPool?: Pool;
};

function getDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL is required for server-side database access.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.", { cause });
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  return value;
}

export function getDatabasePool(): Pool {
  if (globalForPostgres.quincailleriePostgresPool) {
    return globalForPostgres.quincailleriePostgresPool;
  }

  const pool = new Pool({
    connectionString: getDatabaseUrl(),
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "quincaillerie-manager-web",
  });

  pool.on("error", (error) => {
    console.error("Unexpected idle PostgreSQL client error.", error.message);
  });

  globalForPostgres.quincailleriePostgresPool = pool;
  return pool;
}
