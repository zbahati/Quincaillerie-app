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
import { recordAuditLog } from "../repositories/audit-logs";
import {
  createCustomer,
  createSupplier,
  listCustomers,
  listSuppliers,
  updateCustomer,
  updateSupplier,
} from "../repositories/relationships";

export async function listBusinessSuppliers(context: AuthenticatedContext) {
  requirePermission(context, "suppliers.read");
  return listSuppliers(getDatabasePool(), context.businessId);
}

export async function createBusinessSupplier(
  context: AuthenticatedContext,
  input: SupplierCreateInput,
) {
  requirePermission(context, "suppliers.manage");
  return withTransaction(async (client) => {
    const supplier = await createSupplier(client, context.businessId, input);
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
  return withTransaction(async (client) => {
    const supplier = await updateSupplier(client, context.businessId, supplierId, input);
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

export async function listBusinessCustomers(context: AuthenticatedContext) {
  requirePermission(context, "customers.read");
  return listCustomers(getDatabasePool(), context.businessId);
}

export async function createBusinessCustomer(
  context: AuthenticatedContext,
  input: CustomerCreateInput,
) {
  requirePermission(context, "customers.manage");
  return withTransaction(async (client) => {
    const customer = await createCustomer(client, context.businessId, input);
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
  return withTransaction(async (client) => {
    const customer = await updateCustomer(client, context.businessId, customerId, input);
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
