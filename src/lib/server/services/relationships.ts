import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import type {
  CustomerCreateInput,
  CustomerUpdateInput,
  SupplierCreateInput,
  SupplierUpdateInput,
} from "@/lib/server/schemas/relationships";

import { requirePermission } from "../auth/authorization";
import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { withTransaction } from "../db/transaction";
import { findBranchForBusiness } from "../repositories/branches";
import { recordAuditLog } from "../repositories/audit-logs";
import {
  createCustomer,
  createSupplier,
  listCustomers,
  listSuppliers,
  updateCustomer,
  updateSupplier,
} from "../repositories/relationships";

async function resolveRelationshipBranch(
  context: AuthenticatedContext,
  requestedBranchId: string | null,
  allowUnassigned = false,
): Promise<string | null> {
  if (context.role === "manager") {
    if (!context.branchId || requestedBranchId !== context.branchId) {
      throw new AuthServiceError(403, "forbidden", "You cannot access this branch.");
    }
    return context.branchId;
  }

  if (requestedBranchId === null) {
    if (!allowUnassigned) {
      throw new AuthServiceError(400, "branch_required", "Select an active branch.");
    }
    return null;
  }

  const branch = await findBranchForBusiness(
    getDatabasePool(),
    context.businessId,
    requestedBranchId,
  );
  if (!branch || !branch.isActive) {
    throw new AuthServiceError(404, "branch_not_found", "The selected branch is unavailable.");
  }
  return branch.id;
}

async function resolveAssignedRelationshipBranch(
  context: AuthenticatedContext,
  requestedBranchId: string,
): Promise<string> {
  const branchId = await resolveRelationshipBranch(context, requestedBranchId);
  if (!branchId) {
    throw new AuthServiceError(400, "branch_required", "Select an active branch.");
  }
  return branchId;
}

export async function listBusinessSuppliers(
  context: AuthenticatedContext,
  requestedBranchId: string | null,
) {
  requirePermission(context, "suppliers.read");
  const branchId = await resolveRelationshipBranch(context, requestedBranchId, true);
  return listSuppliers(getDatabasePool(), context.businessId, branchId);
}

export async function createBusinessSupplier(
  context: AuthenticatedContext,
  input: SupplierCreateInput,
) {
  requirePermission(context, "suppliers.manage");
  const branchId = await resolveAssignedRelationshipBranch(context, input.branchId);
  return withTransaction(async (client) => {
    const supplier = await createSupplier(client, context.businessId, branchId, input);
    await recordAuditLog(client, {
      businessId: context.businessId,
      userId: context.userId,
      action: "suppliers.supplier_created",
      entityType: "supplier",
      entityId: supplier.id,
      details: { name: supplier.name },
    });
    return supplier;
  });
}

export async function updateBusinessSupplier(
  context: AuthenticatedContext,
  supplierId: string,
  input: SupplierUpdateInput,
) {
  requirePermission(context, "suppliers.manage");
  const branchId = await resolveAssignedRelationshipBranch(context, input.branchId);
  return withTransaction(async (client) => {
    const supplier = await updateSupplier(
      client,
      context.businessId,
      supplierId,
      branchId,
      context.role === "admin",
      input,
    );
    if (!supplier) {
      throw new AuthServiceError(
        404,
        "supplier_not_found",
        "The supplier is unavailable to this business.",
      );
    }
    await recordAuditLog(client, {
      businessId: context.businessId,
      userId: context.userId,
      action: "suppliers.supplier_updated",
      entityType: "supplier",
      entityId: supplier.id,
      details: { name: supplier.name, is_active: supplier.isActive },
    });
    return supplier;
  });
}

export async function listBusinessCustomers(
  context: AuthenticatedContext,
  requestedBranchId: string | null,
) {
  requirePermission(context, "customers.read");
  const branchId = await resolveRelationshipBranch(context, requestedBranchId, true);
  return listCustomers(getDatabasePool(), context.businessId, branchId);
}

export async function createBusinessCustomer(
  context: AuthenticatedContext,
  input: CustomerCreateInput,
) {
  requirePermission(context, "customers.manage");
  const branchId = await resolveAssignedRelationshipBranch(context, input.branchId);
  return withTransaction(async (client) => {
    const customer = await createCustomer(client, context.businessId, branchId, input);
    await recordAuditLog(client, {
      businessId: context.businessId,
      userId: context.userId,
      action: "customers.customer_created",
      entityType: "customer",
      entityId: customer.id,
      details: {
        name: customer.name,
        customer_type: customer.customerType,
        credit_limit: customer.creditLimit,
      },
    });
    return customer;
  });
}

export async function updateBusinessCustomer(
  context: AuthenticatedContext,
  customerId: string,
  input: CustomerUpdateInput,
) {
  requirePermission(context, "customers.manage");
  const branchId = await resolveAssignedRelationshipBranch(context, input.branchId);
  return withTransaction(async (client) => {
    const customer = await updateCustomer(
      client,
      context.businessId,
      customerId,
      branchId,
      context.role === "admin",
      input,
    );
    if (!customer) {
      throw new AuthServiceError(
        404,
        "customer_not_found",
        "The customer is unavailable to this business.",
      );
    }
    await recordAuditLog(client, {
      businessId: context.businessId,
      userId: context.userId,
      action: "customers.customer_updated",
      entityType: "customer",
      entityId: customer.id,
      details: {
        name: customer.name,
        customer_type: customer.customerType,
        credit_limit: customer.creditLimit,
        is_active: customer.isActive,
      },
    });
    return customer;
  });
}
