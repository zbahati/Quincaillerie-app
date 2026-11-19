import "server-only";

import type { PoolClient } from "pg";

import type {
  BranchDetailsInput,
  BranchUpdateInput,
} from "@/lib/server/schemas/identity";

import type { PgExecutor } from "./businesses";

export interface BranchRecord {
  id: string;
  businessId: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  managerCount?: number;
}

const BRANCH_COLUMNS = `
  id,
  business_id AS "businessId",
  name,
  address,
  phone,
  is_active AS "isActive",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export async function listBranchesForBusiness(
  executor: PgExecutor,
  businessId: string,
): Promise<BranchRecord[]> {
  const result = await executor.query<BranchRecord>(
    `SELECT ${BRANCH_COLUMNS}
     FROM branches
     WHERE business_id = $1
     ORDER BY lower(name), id`,
    [businessId],
  );
  return result.rows;
}

export async function listBranchesWithManagerCounts(
  executor: PgExecutor,
  businessId: string,
): Promise<BranchRecord[]> {
  const result = await executor.query<BranchRecord>(
    `SELECT
       branches.id,
       branches.business_id AS "businessId",
       branches.name,
       branches.address,
       branches.phone,
       branches.is_active AS "isActive",
       branches.created_at AS "createdAt",
       branches.updated_at AS "updatedAt",
       COUNT(manager.id)::integer AS "managerCount"
     FROM branches
     LEFT JOIN users AS manager
       ON manager.business_id = branches.business_id
       AND manager.branch_id = branches.id
       AND manager.role = 'manager'
       AND manager.is_active = TRUE
     WHERE branches.business_id = $1
     GROUP BY branches.id
     ORDER BY lower(branches.name), branches.id`,
    [businessId],
  );
  return result.rows;
}

export async function findBranchForBusiness(
  executor: PgExecutor,
  businessId: string,
  branchId: string,
): Promise<BranchRecord | null> {
  const result = await executor.query<BranchRecord>(
    `SELECT ${BRANCH_COLUMNS}
     FROM branches
     WHERE business_id = $1 AND id = $2`,
    [businessId, branchId],
  );
  return result.rows[0] ?? null;
}

export async function findActiveBranchesWithoutManagers(
  executor: PgExecutor,
  businessId: string,
): Promise<string[]> {
  const result = await executor.query<{ branchId: string }>(
    `SELECT branch.id AS "branchId"
     FROM branches AS branch
     WHERE branch.business_id = $1
       AND branch.is_active = TRUE
       AND NOT EXISTS (
         SELECT 1
         FROM users AS manager
         WHERE manager.business_id = branch.business_id
           AND manager.branch_id = branch.id
           AND manager.role = 'manager'
           AND manager.is_active = TRUE
       )
     ORDER BY branch.id`,
    [businessId],
  );
  return result.rows.map((row) => row.branchId);
}

export async function createBranch(
  client: PoolClient,
  businessId: string,
  input: BranchDetailsInput,
  isActive = true,
): Promise<BranchRecord> {
  const result = await client.query<BranchRecord>(
    `INSERT INTO branches (business_id, name, address, phone, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${BRANCH_COLUMNS}`,
    [businessId, input.name, input.address ?? null, input.phone ?? null, isActive],
  );
  const branch = result.rows[0];
  if (!branch) {
    throw new Error("PostgreSQL did not return the created branch.");
  }
  return branch;
}

export async function updateBranchForBusiness(
  client: PoolClient,
  businessId: string,
  branchId: string,
  input: BranchUpdateInput,
): Promise<BranchRecord | null> {
  const result = await client.query<BranchRecord>(
    `UPDATE branches
     SET name = CASE WHEN $3::boolean THEN $4::text ELSE name END,
         address = CASE WHEN $5::boolean THEN $6::text ELSE address END,
         phone = CASE WHEN $7::boolean THEN $8::text ELSE phone END,
         is_active = CASE WHEN $9::boolean THEN $10::boolean ELSE is_active END,
         updated_at = now()
     WHERE business_id = $1 AND id = $2
     RETURNING ${BRANCH_COLUMNS}`,
    [
      businessId,
      branchId,
      input.name !== undefined,
      input.name ?? null,
      input.address !== undefined,
      input.address ?? null,
      input.phone !== undefined,
      input.phone ?? null,
      input.isActive !== undefined,
      input.isActive ?? false,
    ],
  );
  return result.rows[0] ?? null;
}
