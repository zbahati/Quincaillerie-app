import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyMigrations } from "../scripts/run-migrations.mjs";

class MigrationClient {
  applied = new Map();
  statements = [];

  async query(sql, parameters = []) {
    const statement = sql.trim();
    if (
      statement.startsWith("SELECT pg_advisory_lock") ||
      statement.startsWith("SELECT pg_advisory_unlock") ||
      statement.startsWith("CREATE TABLE") ||
      ["BEGIN", "COMMIT", "ROLLBACK"].includes(statement)
    ) {
      return { rows: [], rowCount: 1 };
    }

    if (statement.startsWith("SELECT checksum")) {
      const checksum = this.applied.get(parameters[0]);
      return {
        rows: checksum ? [{ checksum }] : [],
        rowCount: checksum ? 1 : 0,
      };
    }

    if (statement.startsWith("INSERT INTO _application_migrations")) {
      this.applied.set(parameters[0], parameters[1]);
      return { rows: [], rowCount: 1 };
    }

    this.statements.push(statement);
    return { rows: [], rowCount: 1 };
  }
}

test("applies migrations in order and skips unchanged migrations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quincaillerie-migrations-"));
  try {
    await writeFile(join(directory, "0002_second.sql"), "SELECT 2;");
    await writeFile(join(directory, "0001_first.sql"), "SELECT 1;");
    const client = new MigrationClient();

    await applyMigrations(client, directory);
    await applyMigrations(client, directory);

    assert.deepEqual(client.statements, ["SELECT 1;", "SELECT 2;"]);
    assert.deepEqual([...client.applied.keys()], [
      "0001_first.sql",
      "0002_second.sql",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a migration whose applied checksum no longer matches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quincaillerie-migrations-"));
  try {
    const filename = "0001_first.sql";
    const path = join(directory, filename);
    await writeFile(path, "SELECT 1;");
    const client = new MigrationClient();

    await applyMigrations(client, directory);
    await writeFile(path, "SELECT 2;");

    await assert.rejects(
      applyMigrations(client, directory),
      /Applied migration was changed: 0001_first\.sql/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
