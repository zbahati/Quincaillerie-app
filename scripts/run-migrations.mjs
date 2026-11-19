import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "pg";

const MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../db/migrations/", import.meta.url),
);
const LOCK_NAMESPACE = 1212446790;
const LOCK_ID = 1;

export async function applyMigrations(client, migrationsDirectory) {
  await client.query("SELECT pg_advisory_lock($1, $2)", [
    LOCK_NAMESPACE,
    LOCK_ID,
  ]);

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _application_migrations (
        migration_name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const filenames = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith(".sql"))
      .sort();

    if (filenames.length === 0) {
      throw new Error("No application migrations found.");
    }

    for (const filename of filenames) {
      if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(filename)) {
        throw new Error(`Unsupported migration filename: ${filename}`);
      }

      const contents = await readFile(join(migrationsDirectory, filename));
      const checksum = createHash("sha256").update(contents).digest("hex");
      const applied = await client.query(
        "SELECT checksum FROM _application_migrations WHERE migration_name = $1",
        [filename],
      );

      if (applied.rowCount > 0) {
        if (applied.rows[0].checksum !== checksum) {
          throw new Error(`Applied migration was changed: ${filename}`);
        }
        console.log(`Already applied: ${filename}`);
        continue;
      }

      console.log(`Applying: ${filename}`);
      await client.query("BEGIN");
      try {
        await client.query(contents.toString("utf8"));
        await client.query(
          "INSERT INTO _application_migrations (migration_name, checksum) VALUES ($1, $2)",
          [filename, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, $2)", [
      LOCK_NAMESPACE,
      LOCK_ID,
    ]);
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run application migrations.");
  }

  let connectionUrl;
  try {
    connectionUrl = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (
    connectionUrl.protocol !== "postgres:" &&
    connectionUrl.protocol !== "postgresql:"
  ) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  const client = new Client({
    connectionString,
    application_name: "quincaillerie-manager-migrations",
  });

  let connected = false;
  try {
    await client.connect();
    connected = true;
    await applyMigrations(client, MIGRATIONS_DIRECTORY);
  } finally {
    if (connected) {
      await client.end();
    }
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error("Database migration failed.", error);
    process.exitCode = 1;
  });
}
