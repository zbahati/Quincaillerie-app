import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { requestSessionToken } from "@/lib/server/auth/http";
import type { CustomerRecord, SupplierRecord } from "@/lib/server/repositories/relationships";
import { customerIdSchema, supplierIdSchema } from "@/lib/server/schemas/relationships";
import type { NextRequest } from "next/server";

export async function authenticatedRelationshipContext(request: NextRequest) {
  const context = await findAuthenticatedContext(requestSessionToken(request));
  if (!context) {
    throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
  }
  return context;
}

export function parseRelationshipBranchId(value: string | null): string | null {
  if (value === "unassigned") return null;
  const parsed = supplierIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AuthServiceError(400, "branch_required", "Select an active branch.");
  }
  return parsed.data;
}

export function parseSupplierId(value: string): string {
  const parsed = supplierIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AuthServiceError(400, "invalid_supplier_id", "The supplier ID is invalid.");
  }
  return parsed.data;
}

export function parseCustomerId(value: string): string {
  const parsed = customerIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AuthServiceError(400, "invalid_customer_id", "The customer ID is invalid.");
  }
  return parsed.data;
}

export function supplierDto(supplier: SupplierRecord) {
  return {
    id: supplier.id,
    business_id: supplier.businessId,
    branch_id: supplier.branchId,
    name: supplier.name,
    contact_person: supplier.contactPerson,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    tax_id: supplier.taxId,
    is_active: supplier.isActive,
  };
}

export function customerDto(customer: CustomerRecord) {
  return {
    id: customer.id,
    business_id: customer.businessId,
    branch_id: customer.branchId,
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    customer_type: customer.customerType,
    credit_limit: customer.creditLimit,
    is_active: customer.isActive,
  };
}
