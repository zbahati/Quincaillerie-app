import "server-only";

import type { PoolClient } from "pg";

import { getDatabasePool } from "./pool";

export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getDatabasePool().connect();
  let transactionStarted = false;
  let releaseError: Error | undefined;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const result = await operation(client);
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (cause) {
    if (!transactionStarted) {
      releaseError = cause instanceof Error ? cause : new Error("Transaction could not start.");
    } else {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackCause) {
        const rollbackError = new AggregateError(
          [cause, rollbackCause],
          "The transaction failed and PostgreSQL could not roll it back.",
          { cause },
        );
        releaseError = rollbackError;
        throw rollbackError;
      }
    }

    throw cause;
  } finally {
    client.release(releaseError);
  }
}
