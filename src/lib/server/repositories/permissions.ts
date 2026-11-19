import "server-only";

import type { AuthRole } from "@/lib/api/auth-api";

import type { PgExecutor } from "./businesses";

export async function listPermissionsForUser(
  executor: PgExecutor,
  businessId: string,
  role: AuthRole,
): Promise<string[]> {
  const result =
    role === "admin"
      ? await executor.query<{ id: string }>(
          "SELECT id FROM permissions ORDER BY id",
        )
      : await executor.query<{ permissionId: string }>(
          `SELECT permission_id AS "permissionId"
           FROM business_manager_permissions
           WHERE business_id = $1 AND enabled = TRUE
           ORDER BY permission_id`,
          [businessId],
        );

  return result.rows.map((row) => ("id" in row ? row.id : row.permissionId));
}
