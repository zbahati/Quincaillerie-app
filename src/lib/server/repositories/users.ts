import "server-only";

import type { PoolClient } from "pg";

import type { AuthRole } from "@/lib/api/auth-api";
import type {
  ManagerCreateInput,
  ManagerUpdateInput,
} from "@/lib/server/schemas/identity";

import type { PgExecutor } from "./businesses";

export interface UserRecord {
  id: string;
  businessId: string;
  branchId: string | null;
  role: AuthRole;
  username: string;
  fullName: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthCredentialRecord extends UserRecord {
  passwordHash: string;
  businessIsActive: boolean;
  branchIsActive: boolean | null;
}

export interface ManagerRecord extends UserRecord {
  lastLoginAt: Date | null;
}

const USER_COLUMNS = `
  user_row.id,
  user_row.business_id AS "businessId",
  user_row.branch_id AS "branchId",
  user_row.role,
  user_row.username,
  user_row.full_name AS "fullName",
  user_row.email,
  user_row.email_verified_at AS "emailVerifiedAt",
  user_row.is_active AS "isActive",
  user_row.created_at AS "createdAt",
  user_row.updated_at AS "updatedAt"
`;

const MANAGER_COLUMNS = `
  user_row.id,
  user_row.business_id AS "businessId",
  user_row.branch_id AS "branchId",
  user_row.role,
  user_row.username,
  user_row.full_name AS "fullName",
  user_row.email,
  user_row.email_verified_at AS "emailVerifiedAt",
  user_row.is_active AS "isActive",
  user_row.last_login_at AS "lastLoginAt",
  user_row.created_at AS "createdAt",
  user_row.updated_at AS "updatedAt"
`;

export async function findAuthCredentials(
  executor: PgExecutor,
  businessId: string,
  username: string,
): Promise<AuthCredentialRecord | null> {
  const result = await executor.query<AuthCredentialRecord>(
    `SELECT
       ${USER_COLUMNS},
       user_row.password_hash AS "passwordHash",
       b.is_active AS "businessIsActive",
       branch.is_active AS "branchIsActive"
     FROM users AS user_row
     JOIN businesses AS b ON b.id = user_row.business_id
     LEFT JOIN branches AS branch
       ON branch.id = user_row.branch_id
       AND branch.business_id = user_row.business_id
     WHERE user_row.business_id = $1 AND user_row.username = $2`,
    [businessId, username],
  );
  return result.rows[0] ?? null;
}

export async function businessHasAdmin(
  executor: PgExecutor,
  businessId: string,
): Promise<boolean> {
  const result = await executor.query<{ hasAdmin: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM users
       WHERE business_id = $1 AND role = 'admin'
     ) AS "hasAdmin"`,
    [businessId],
  );
  return result.rows[0]?.hasAdmin ?? false;
}

export async function findUserForBusiness(
  executor: PgExecutor,
  businessId: string,
  userId: string,
): Promise<UserRecord | null> {
  const result = await executor.query<UserRecord>(
    `SELECT ${USER_COLUMNS}
     FROM users AS user_row
     WHERE user_row.business_id = $1 AND user_row.id = $2`,
    [businessId, userId],
  );
  return result.rows[0] ?? null;
}

export async function createAdminUser(
  client: PoolClient,
  input: {
    businessId: string;
    username: string;
    fullName: string;
    email: string;
    passwordHash: string;
  },
): Promise<UserRecord> {
  const result = await client.query<UserRecord>(
    `INSERT INTO users AS user_row (business_id, role, username, full_name, email, password_hash)
     VALUES ($1, 'admin', $2, $3, $4, $5)
     RETURNING ${USER_COLUMNS}`,
    [input.businessId, input.username, input.fullName, input.email, input.passwordHash],
  );
  const user = result.rows[0];
  if (!user) {
    throw new Error("PostgreSQL did not return the created Admin user.");
  }
  return user;
}

export async function createManagerUser(
  client: PoolClient,
  input: Omit<ManagerCreateInput, "password"> & {
    businessId: string;
    passwordHash: string;
  },
): Promise<UserRecord> {
  const result = await client.query<UserRecord>(
    `INSERT INTO users AS user_row (business_id, branch_id, role, username, full_name, password_hash)
     VALUES ($1, $2, 'manager', $3, $4, $5)
     RETURNING ${USER_COLUMNS}`,
    [input.businessId, input.branchId, input.username, input.fullName, input.passwordHash],
  );
  const user = result.rows[0];
  if (!user) {
    throw new Error("PostgreSQL did not return the created Manager user.");
  }
  return user;
}

export async function listManagersForBusiness(
  executor: PgExecutor,
  businessId: string,
): Promise<(ManagerRecord & { branchName: string })[]> {
  const result = await executor.query<ManagerRecord & { branchName: string }>(
    `SELECT ${MANAGER_COLUMNS},
       branch.name AS "branchName"
     FROM users AS user_row
     JOIN branches AS branch
       ON branch.business_id = user_row.business_id
       AND branch.id = user_row.branch_id
     WHERE user_row.business_id = $1 AND user_row.role = 'manager'
     ORDER BY user_row.is_active DESC, lower(user_row.full_name), user_row.id`,
    [businessId],
  );
  return result.rows;
}

export async function updateManagerForBusiness(
  client: PoolClient,
  businessId: string,
  managerId: string,
  input: ManagerUpdateInput,
): Promise<ManagerRecord | null> {
  const result = await client.query<ManagerRecord>(
    `UPDATE users AS user_row
     SET branch_id = CASE WHEN $3::boolean THEN $4::uuid ELSE user_row.branch_id END,
         is_active = CASE WHEN $5::boolean THEN $6::boolean ELSE user_row.is_active END,
         full_name = CASE WHEN $7::boolean THEN $8::text ELSE user_row.full_name END,
         updated_at = now()
     WHERE user_row.business_id = $1
       AND user_row.id = $2
       AND user_row.role = 'manager'
     RETURNING ${MANAGER_COLUMNS}`,
    [
      businessId,
      managerId,
      input.branchId !== undefined,
      input.branchId ?? null,
      input.isActive !== undefined,
      input.isActive ?? false,
      input.fullName !== undefined,
      input.fullName ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function updateManagerPassword(
  client: PoolClient,
  businessId: string,
  managerId: string,
  passwordHash: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE users
     SET password_hash = $3, updated_at = now()
     WHERE business_id = $1 AND id = $2 AND role = 'manager'`,
    [businessId, managerId, passwordHash],
  );
  return result.rowCount === 1;
}

export async function revokeBranchManagerSessions(
  client: PoolClient,
  businessId: string,
  branchId: string,
): Promise<number> {
  const result = await client.query(
    `UPDATE auth_sessions AS session
     SET revoked_at = now()
     FROM users AS manager
     WHERE session.business_id = $1
       AND manager.business_id = session.business_id
       AND manager.id = session.user_id
       AND manager.role = 'manager'
       AND manager.branch_id = $2
       AND session.revoked_at IS NULL`,
    [businessId, branchId],
  );
  return result.rowCount ?? 0;
}
