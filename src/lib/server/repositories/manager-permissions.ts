import "server-only";

import type { PoolClient } from "pg";

import type { ManagerPermissionUpdate } from "@/lib/server/schemas/identity";

import type { PgExecutor } from "./businesses";

export interface ManagerPermissionRecord {
  permissionId: string;
  description: string;
  enabled: boolean;
  enabledByDefault: boolean;
}

export async function listManagerPermissions(
  executor: PgExecutor,
  businessId: string,
): Promise<ManagerPermissionRecord[]> {
  const result = await executor.query<ManagerPermissionRecord>(
    `SELECT
       catalog.permission_id AS "permissionId",
      permission.description,
       grant_row.enabled,
       catalog.enabled_by_default AS "enabledByDefault"
     FROM business_manager_permissions AS grant_row
     JOIN manager_permission_catalog AS catalog
       ON catalog.permission_id = grant_row.permission_id
    JOIN permissions AS permission
      ON permission.id = catalog.permission_id
     WHERE grant_row.business_id = $1
     ORDER BY catalog.permission_id`,
    [businessId],
  );
  return result.rows;
}

export async function seedDefaultManagerPermissions(
  client: PoolClient,
  businessId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO business_manager_permissions (business_id, permission_id, enabled)
     SELECT $1, permission_id, enabled_by_default
     FROM manager_permission_catalog
     ON CONFLICT (business_id, permission_id) DO NOTHING`,
    [businessId],
  );
}

export async function replaceManagerPermissions(
  client: PoolClient,
  businessId: string,
  updatedByUserId: string,
  grants: ManagerPermissionUpdate,
): Promise<void> {
  const result = await client.query(
    `INSERT INTO business_manager_permissions
       (business_id, permission_id, enabled, updated_by_user_id, updated_at)
     SELECT $1, input.permission_id, input.enabled, $2, now()
     FROM unnest($3::text[], $4::boolean[]) AS input(permission_id, enabled)
     ON CONFLICT (business_id, permission_id) DO UPDATE
       SET enabled = EXCLUDED.enabled,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = EXCLUDED.updated_at`,
    [
      businessId,
      updatedByUserId,
      grants.map((grant) => grant.permissionId),
      grants.map((grant) => grant.enabled),
    ],
  );
  if (result.rowCount !== grants.length) {
    throw new Error("PostgreSQL did not update the complete Manager permission set.");
  }
}
