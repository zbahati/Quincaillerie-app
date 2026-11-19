import "server-only";

import type { PoolClient } from "pg";

import type { AuthRole } from "@/lib/api/auth-api";

import type { PgExecutor } from "./businesses";

export interface ActiveAuthSessionRecord {
  sessionId: string;
  userId: string;
  businessId: string;
  username: string;
  fullName: string;
  role: AuthRole;
  branchId: string | null;
}

export async function createAuthSession(
  client: PoolClient,
  input: {
    businessId: string;
    userId: string;
    tokenHash: Buffer;
    expiresAt: Date;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO auth_sessions (business_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.businessId, input.userId, input.tokenHash, input.expiresAt],
  );
  const sessionId = result.rows[0]?.id;
  if (!sessionId) {
    throw new Error("PostgreSQL did not return the created session.");
  }
  return sessionId;
}

export async function recordSuccessfulLogin(
  client: PoolClient,
  businessId: string,
  userId: string,
  expectedPasswordHash: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE users AS user_row
     SET last_login_at = now(), updated_at = now()
     WHERE user_row.business_id = $1
       AND user_row.id = $2
       AND user_row.password_hash = $3
       AND user_row.is_active = TRUE
       AND (
         (user_row.role = 'admin'
           AND user_row.email_verified_at IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM businesses
             WHERE id = user_row.business_id AND is_active = TRUE
           ))
         OR
         (user_row.role = 'manager'
           AND EXISTS (
             SELECT 1
             FROM businesses AS business
             JOIN branches AS branch
               ON branch.business_id = business.id
             WHERE business.id = user_row.business_id
               AND business.is_active = TRUE
               AND branch.id = user_row.branch_id
               AND branch.is_active = TRUE
           ))
       )`,
    [businessId, userId, expectedPasswordHash],
  );
  return result.rowCount === 1;
}

export async function findActiveAuthSession(
  executor: PgExecutor,
  tokenHash: Buffer,
): Promise<ActiveAuthSessionRecord | null> {
  const result = await executor.query<ActiveAuthSessionRecord>(
    `SELECT
       session.id AS "sessionId",
       user_row.id AS "userId",
       user_row.business_id AS "businessId",
       user_row.username,
       user_row.full_name AS "fullName",
       user_row.role,
       user_row.branch_id AS "branchId"
     FROM auth_sessions AS session
     JOIN users AS user_row
       ON user_row.id = session.user_id
       AND user_row.business_id = session.business_id
     JOIN businesses AS business
       ON business.id = user_row.business_id
     LEFT JOIN branches AS branch
       ON branch.id = user_row.branch_id
       AND branch.business_id = user_row.business_id
     WHERE session.token_hash = $1
       AND session.revoked_at IS NULL
       AND session.expires_at > now()
       AND user_row.is_active = TRUE
       AND business.is_active = TRUE
       AND (user_row.role <> 'admin' OR user_row.email_verified_at IS NOT NULL)
       AND (user_row.role <> 'manager' OR branch.is_active = TRUE)`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function revokeAuthSession(
  executor: PgExecutor,
  tokenHash: Buffer,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE auth_sessions
     SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
  return result.rowCount === 1;
}

export async function revokeUserAuthSessions(
  client: PoolClient,
  businessId: string,
  userId: string,
): Promise<number> {
  const result = await client.query(
    `UPDATE auth_sessions
     SET revoked_at = now()
     WHERE business_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [businessId, userId],
  );
  return result.rowCount ?? 0;
}
