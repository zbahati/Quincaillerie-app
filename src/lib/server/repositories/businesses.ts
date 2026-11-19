import "server-only";

import type { Pool, PoolClient } from "pg";

import type { BusinessDetailsInput } from "@/lib/server/schemas/identity";

export type PgExecutor = Pool | PoolClient;

export interface BusinessRecord {
  id: string;
  name: string;
  taxId: string | null;
  currency: string;
  timezone: string;
  dateFormat: string;
  language: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthBusinessStatusRecord {
  id: string;
  name: string;
  requiresAdminSetup: boolean;
  requiresAdminVerification: boolean;
}

const BUSINESS_COLUMNS = `
  id,
  name,
  tax_id AS "taxId",
  currency,
  timezone,
  date_format AS "dateFormat",
  language,
  is_active AS "isActive",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export async function findBusinessById(
  executor: PgExecutor,
  businessId: string,
): Promise<BusinessRecord | null> {
  const result = await executor.query<BusinessRecord>(
    `SELECT ${BUSINESS_COLUMNS} FROM businesses WHERE id = $1`,
    [businessId],
  );
  return result.rows[0] ?? null;
}

export async function listAuthBusinessStatuses(
  executor: PgExecutor,
): Promise<AuthBusinessStatusRecord[]> {
  const result = await executor.query<AuthBusinessStatusRecord>(
    `SELECT
       business.id,
       business.name,
       NOT EXISTS (
         SELECT 1
         FROM users AS admin_user
         WHERE admin_user.business_id = business.id
           AND admin_user.role = 'admin'
       ) AS "requiresAdminSetup",
       EXISTS (
         SELECT 1
         FROM users AS admin_user
         WHERE admin_user.business_id = business.id
           AND admin_user.role = 'admin'
           AND admin_user.is_active = TRUE
           AND admin_user.email_verified_at IS NULL
       ) AS "requiresAdminVerification"
     FROM businesses AS business
     WHERE business.is_active = TRUE
     ORDER BY lower(business.name), business.id`,
  );
  return result.rows;
}

export async function createBusiness(
  client: PoolClient,
  input: { name: string },
): Promise<BusinessRecord> {
  const result = await client.query<BusinessRecord>(
    `INSERT INTO businesses (name)
     VALUES ($1)
     RETURNING ${BUSINESS_COLUMNS}`,
    [input.name],
  );
  const business = result.rows[0];
  if (!business) {
    throw new Error("PostgreSQL did not return the created business.");
  }
  return business;
}

export async function lockActiveBusinessForAdministration(
  client: PoolClient,
  businessId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT id
     FROM businesses
     WHERE id = $1 AND is_active = TRUE
     FOR UPDATE`,
    [businessId],
  );
  return result.rowCount === 1;
}

export async function lockActiveBusinessForSignIn(
  client: PoolClient,
  businessId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT id
     FROM businesses
     WHERE id = $1 AND is_active = TRUE
     FOR SHARE`,
    [businessId],
  );
  return result.rowCount === 1;
}

export async function updateBusinessDetails(
  client: PoolClient,
  businessId: string,
  input: BusinessDetailsInput,
): Promise<BusinessRecord> {
  const result = await client.query<BusinessRecord>(
    `UPDATE businesses
     SET name = $2, tax_id = $3, updated_at = now()
     WHERE id = $1 AND is_active = TRUE
     RETURNING ${BUSINESS_COLUMNS}`,
    [businessId, input.name, input.taxId],
  );
  const business = result.rows[0];
  if (!business) {
    throw new Error("The business is unavailable for administration.");
  }
  return business;
}
