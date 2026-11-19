import "server-only";

import type { PoolClient } from "pg";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AuditLogInput {
  businessId: string;
  userId: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: { [key: string]: JsonValue } | null;
}

export async function recordAuditLog(
  client: PoolClient,
  input: AuditLogInput,
): Promise<string> {
  const details = input.details === undefined || input.details === null
    ? null
    : JSON.stringify(input.details);
  if (input.details !== undefined && input.details !== null && details === undefined) {
    throw new Error("Audit details could not be serialized as JSON.");
  }

  const result = await client.query<{ id: string }>(
    `INSERT INTO audit_logs
       (business_id, user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id`,
    [
      input.businessId,
      input.userId,
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      details,
    ],
  );
  const auditId = result.rows[0]?.id;
  if (!auditId) {
    throw new Error("PostgreSQL did not return the created audit log.");
  }
  return auditId;
}
