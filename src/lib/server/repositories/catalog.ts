import "server-only";

import type { Pool, PoolClient } from "pg";

import type {
  BrandCreateInput,
  CategoryCreateInput,
  UnitCreateInput,
} from "@/lib/server/schemas/catalog";

export type CatalogExecutor = Pool | PoolClient;

export interface CategoryRecord {
  id: string;
  businessId: string;
  parentId: string | null;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface BrandRecord {
  id: string;
  businessId: string;
  name: string;
  isActive: boolean;
}

export interface UnitRecord {
  id: string;
  businessId: string | null;
  code: string;
  name: string;
  decimalsOk: boolean;
  isSystem: boolean;
  isActive: boolean;
}

const CATEGORY_COLUMNS = `
  id,
  business_id AS "businessId",
  parent_id AS "parentId",
  name,
  description,
  is_active AS "isActive"
`;

const BRAND_COLUMNS = `
  id,
  business_id AS "businessId",
  name,
  is_active AS "isActive"
`;

const UNIT_COLUMNS = `
  id,
  business_id AS "businessId",
  code,
  name,
  decimals_ok AS "decimalsOk",
  is_system AS "isSystem",
  is_active AS "isActive"
`;

export async function listCategories(
  executor: CatalogExecutor,
  businessId: string,
): Promise<CategoryRecord[]> {
  const result = await executor.query<CategoryRecord>(
    `SELECT ${CATEGORY_COLUMNS}
     FROM categories
     WHERE business_id = $1
     ORDER BY sort_order, name, id`,
    [businessId],
  );
  return result.rows;
}

export async function findCategory(
  executor: CatalogExecutor,
  businessId: string,
  categoryId: string,
): Promise<CategoryRecord | null> {
  const result = await executor.query<CategoryRecord>(
    `SELECT ${CATEGORY_COLUMNS}
     FROM categories
     WHERE business_id = $1 AND id = $2`,
    [businessId, categoryId],
  );
  return result.rows[0] ?? null;
}

export async function createCategory(
  client: PoolClient,
  businessId: string,
  input: CategoryCreateInput,
): Promise<CategoryRecord> {
  const result = await client.query<CategoryRecord>(
    `INSERT INTO categories (business_id, parent_id, name, description)
     VALUES ($1, $2, $3, $4)
     RETURNING ${CATEGORY_COLUMNS}`,
    [businessId, input.parentId ?? null, input.name, input.description ?? null],
  );
  const category = result.rows[0];
  if (!category) {
    throw new Error("PostgreSQL did not return the created category.");
  }
  return category;
}

export async function listBrands(
  executor: CatalogExecutor,
  businessId: string,
): Promise<BrandRecord[]> {
  const result = await executor.query<BrandRecord>(
    `SELECT ${BRAND_COLUMNS}
     FROM brands
     WHERE business_id = $1
     ORDER BY lower(name), id`,
    [businessId],
  );
  return result.rows;
}

export async function createBrand(
  client: PoolClient,
  businessId: string,
  input: BrandCreateInput,
): Promise<BrandRecord> {
  const result = await client.query<BrandRecord>(
    `INSERT INTO brands (business_id, name)
     VALUES ($1, $2)
     RETURNING ${BRAND_COLUMNS}`,
    [businessId, input.name],
  );
  const brand = result.rows[0];
  if (!brand) {
    throw new Error("PostgreSQL did not return the created brand.");
  }
  return brand;
}

export async function listUnits(
  executor: CatalogExecutor,
  businessId: string,
): Promise<UnitRecord[]> {
  const result = await executor.query<UnitRecord>(
    `SELECT ${UNIT_COLUMNS}
     FROM units
     WHERE business_id IS NULL OR business_id = $1
     ORDER BY is_system DESC, name, id`,
    [businessId],
  );
  return result.rows;
}

export async function createUnit(
  client: PoolClient,
  businessId: string,
  input: UnitCreateInput,
): Promise<UnitRecord> {
  const result = await client.query<UnitRecord>(
    `INSERT INTO units (business_id, code, name, decimals_ok)
     VALUES ($1, $2, $3, $4)
     RETURNING ${UNIT_COLUMNS}`,
    [businessId, input.code, input.name, input.decimalsOk],
  );
  const unit = result.rows[0];
  if (!unit) {
    throw new Error("PostgreSQL did not return the created unit.");
  }
  return unit;
}
