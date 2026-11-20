import "server-only";

import type { Pool, PoolClient } from "pg";

import type {
  CustomerCreateInput,
  CustomerUpdateInput,
  SupplierCreateInput,
  SupplierUpdateInput,
} from "@/lib/server/schemas/relationships";

export type RelationshipExecutor = Pool | PoolClient;

export interface SupplierRecord {
  id: string;
  businessId: string;
  branchId: string | null;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  isActive: boolean;
}

export interface CustomerRecord {
  id: string;
  businessId: string;
  branchId: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  customerType: "individual" | "business";
  creditLimit: number;
  isActive: boolean;
}

interface CustomerRow extends Omit<CustomerRecord, "creditLimit"> {
  creditLimit: string;
}

function safeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`The stored ${field} exceeds the browser's safe integer range.`);
  }
  return parsed;
}

function mapCustomer(row: CustomerRow): CustomerRecord {
  return { ...row, creditLimit: safeInteger(row.creditLimit, "customer credit limit") };
}

const SUPPLIER_COLUMNS = `
  id,
  business_id AS "businessId",
  branch_id AS "branchId",
  name,
  contact_person AS "contactPerson",
  phone,
  email,
  address,
  tax_id AS "taxId",
  is_active AS "isActive"
`;

const CUSTOMER_COLUMNS = `
  id,
  business_id AS "businessId",
  branch_id AS "branchId",
  name,
  phone,
  address,
  customer_type AS "customerType",
  credit_limit::text AS "creditLimit",
  is_active AS "isActive"
`;

export async function listSuppliers(
  executor: RelationshipExecutor,
  businessId: string,
  branchId: string | null,
): Promise<SupplierRecord[]> {
  const result = await executor.query<SupplierRecord>(
    `SELECT ${SUPPLIER_COLUMNS}
     FROM suppliers
     WHERE business_id = $1 AND branch_id IS NOT DISTINCT FROM $2::uuid
     ORDER BY is_active DESC, lower(name), id`,
    [businessId, branchId],
  );
  return result.rows;
}

export async function createSupplier(
  executor: RelationshipExecutor,
  businessId: string,
  branchId: string,
  input: SupplierCreateInput,
): Promise<SupplierRecord> {
  const result = await executor.query<SupplierRecord>(
    `INSERT INTO suppliers
       (business_id, branch_id, name, contact_person, phone, email, address, tax_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${SUPPLIER_COLUMNS}`,
    [
      businessId,
      branchId,
      input.name,
      input.contactPerson,
      input.phone,
      input.email,
      input.address,
      input.taxId,
    ],
  );
  const supplier = result.rows[0];
  if (!supplier) {
    throw new Error("PostgreSQL did not return the created supplier.");
  }
  return supplier;
}

export async function updateSupplier(
  executor: RelationshipExecutor,
  businessId: string,
  supplierId: string,
  branchId: string,
  allowUnassigned: boolean,
  input: SupplierUpdateInput,
): Promise<SupplierRecord | null> {
  const result = await executor.query<SupplierRecord>(
    `UPDATE suppliers
     SET branch_id = $10,
         name = $3,
         contact_person = $4,
         phone = $5,
         email = $6,
         address = $7,
         tax_id = $8,
         is_active = $9,
         updated_at = now()
     WHERE business_id = $1 AND id = $2
       AND (branch_id = $10 OR ($11::boolean AND branch_id IS NULL))
     RETURNING ${SUPPLIER_COLUMNS}`,
    [
      businessId,
      supplierId,
      input.name,
      input.contactPerson,
      input.phone,
      input.email,
      input.address,
      input.taxId,
      input.isActive,
      branchId,
      allowUnassigned,
    ],
  );
  return result.rows[0] ?? null;
}

export async function listCustomers(
  executor: RelationshipExecutor,
  businessId: string,
  branchId: string | null,
): Promise<CustomerRecord[]> {
  const result = await executor.query<CustomerRow>(
    `SELECT ${CUSTOMER_COLUMNS}
     FROM customers
     WHERE business_id = $1 AND branch_id IS NOT DISTINCT FROM $2::uuid
     ORDER BY is_active DESC, lower(name), id`,
    [businessId, branchId],
  );
  return result.rows.map(mapCustomer);
}

export async function createCustomer(
  executor: RelationshipExecutor,
  businessId: string,
  branchId: string,
  input: CustomerCreateInput,
): Promise<CustomerRecord> {
  const result = await executor.query<CustomerRow>(
    `INSERT INTO customers
       (business_id, branch_id, name, phone, address, customer_type, credit_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${CUSTOMER_COLUMNS}`,
    [
      businessId,
      branchId,
      input.name,
      input.phone,
      input.address,
      input.customerType,
      input.creditLimit,
    ],
  );
  const customer = result.rows[0];
  if (!customer) {
    throw new Error("PostgreSQL did not return the created customer.");
  }
  return mapCustomer(customer);
}

export async function updateCustomer(
  executor: RelationshipExecutor,
  businessId: string,
  customerId: string,
  branchId: string,
  allowUnassigned: boolean,
  input: CustomerUpdateInput,
): Promise<CustomerRecord | null> {
  const result = await executor.query<CustomerRow>(
    `UPDATE customers
     SET branch_id = $9,
         name = $3,
         phone = $4,
         address = $5,
         customer_type = $6,
         credit_limit = $7,
         is_active = $8,
         updated_at = now()
     WHERE business_id = $1 AND id = $2
       AND (branch_id = $9 OR ($10::boolean AND branch_id IS NULL))
     RETURNING ${CUSTOMER_COLUMNS}`,
    [
      businessId,
      customerId,
      input.name,
      input.phone,
      input.address,
      input.customerType,
      input.creditLimit,
      input.isActive,
      branchId,
      allowUnassigned,
    ],
  );
  const customer = result.rows[0];
  return customer ? mapCustomer(customer) : null;
}
