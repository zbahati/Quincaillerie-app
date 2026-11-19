import "server-only";

import type { PoolClient } from "pg";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import type {
  InventoryListQuery,
  OpeningStockInput,
  StockCorrectionInput,
  StockMovementListQuery,
  StockReceiptInput,
} from "@/lib/server/schemas/inventory";

import { requireBusinessScope, requirePermission } from "../auth/authorization";
import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { withTransaction } from "../db/transaction";
import { recordAuditLog } from "../repositories/audit-logs";
import { findBranchForBusiness, listBranchesForBusiness } from "../repositories/branches";
import {
  correctStock,
  InventoryRuleError,
  listInventory,
  listStockMovements,
  lockInventoryBranch,
  receiveStock,
  setOpeningStock,
} from "../repositories/inventory";
import { findProduct, ProductRuleError, updateBaseSellingPrice } from "../repositories/products";

function raiseInventoryRule(cause: unknown): never {
  if (cause instanceof InventoryRuleError) {
    throw new AuthServiceError(cause.status, cause.code, cause.message);
  }
  if (cause instanceof ProductRuleError) {
    throw new AuthServiceError(cause.status, cause.code, cause.message);
  }
  throw cause;
}

async function resolveBranch(
  context: AuthenticatedContext,
  requestedBranchId?: string,
) {
  let branchId = requestedBranchId;
  if (context.role === "manager") {
    if (!context.branchId || (branchId && branchId !== context.branchId)) {
      throw new AuthServiceError(403, "forbidden", "You cannot access this branch.");
    }
    branchId = context.branchId;
  } else if (!branchId) {
    throw new AuthServiceError(400, "branch_required", "Select a branch to view its inventory.");
  }

  const branch = await findBranchForBusiness(
    getDatabasePool(),
    context.businessId,
    branchId,
  );
  if (!branch) {
    throw new AuthServiceError(404, "branch_not_found", "The branch is unavailable to this business.");
  }
  requireBusinessScope(context, context.businessId, branch.id);
  return branch;
}

async function lockWriteScope(
  client: PoolClient,
  context: AuthenticatedContext,
  branchId: string,
): Promise<void> {
  const business = await client.query(
    `SELECT id
     FROM businesses
     WHERE id = $1 AND is_active = TRUE
     FOR SHARE`,
    [context.businessId],
  );
  if (business.rowCount !== 1) {
    throw new AuthServiceError(404, "business_not_found", "The business is unavailable.");
  }

  const user = await client.query<{ role: string; branchId: string | null }>(
    `SELECT role, branch_id AS "branchId"
     FROM users
     WHERE business_id = $1 AND id = $2 AND is_active = TRUE
     FOR SHARE`,
    [context.businessId, context.userId],
  );
  const currentUser = user.rows[0];
  if (
    !currentUser ||
    currentUser.role !== context.role ||
    currentUser.branchId !== context.branchId
  ) {
    throw new AuthServiceError(403, "session_scope_changed", "Your access changed. Sign in again.");
  }

  requireBusinessScope(context, context.businessId, branchId);
  await lockInventoryBranch(client, context.businessId, branchId);
}

export async function listBusinessInventoryBranches(context: AuthenticatedContext) {
  requirePermission(context, "inventory.read");
  if (context.role === "admin") {
    return listBranchesForBusiness(getDatabasePool(), context.businessId);
  }
  if (!context.branchId) {
    throw new AuthServiceError(403, "forbidden", "A branch assignment is required for inventory access.");
  }
  const branch = await findBranchForBusiness(
    getDatabasePool(),
    context.businessId,
    context.branchId,
  );
  if (!branch || !branch.isActive) {
    throw new AuthServiceError(403, "forbidden", "Your assigned branch is unavailable.");
  }
  return [branch];
}

export async function listBusinessInventory(
  context: AuthenticatedContext,
  query: InventoryListQuery,
) {
  requirePermission(context, "inventory.read");
  const branch = await resolveBranch(context, query.branchId);
  return listInventory(getDatabasePool(), context.businessId, branch.id, query);
}

export async function listBusinessStockMovements(
  context: AuthenticatedContext,
  productId: string,
  query: StockMovementListQuery,
) {
  requirePermission(context, "inventory.read");
  const branch = await resolveBranch(context, query.branchId);
  if (!(await findProduct(getDatabasePool(), context.businessId, productId))) {
    throw new AuthServiceError(404, "product_not_found", "The product is unavailable to this business.");
  }
  return listStockMovements(
    getDatabasePool(),
    context.businessId,
    branch.id,
    productId,
    query,
  );
}

export async function recordBusinessOpeningStock(
  context: AuthenticatedContext,
  productId: string,
  input: OpeningStockInput,
) {
  requirePermission(context, "inventory.manage");
  const branch = await resolveBranch(context, input.branchId);
  try {
    return await withTransaction(async (client) => {
      await lockWriteScope(client, context, branch.id);
      const movement = await setOpeningStock(client, {
        ...input,
        businessId: context.businessId,
        branchId: branch.id,
        productId,
        userId: context.userId,
      });
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "inventory.opening_stock_recorded",
        entityType: "stock_movement",
        entityId: movement.id,
        details: {
          branch_id: branch.id,
          product_id: productId,
          quantity: movement.quantityDelta,
          unit_cost: movement.unitCost ?? 0,
          reason: movement.reason,
        },
      });
      return movement;
    });
  } catch (cause) {
    raiseInventoryRule(cause);
  }
}

export async function correctBusinessStock(
  context: AuthenticatedContext,
  productId: string,
  input: StockCorrectionInput,
) {
  requirePermission(context, "inventory.manage");
  const branch = await resolveBranch(context, input.branchId);
  try {
    return await withTransaction(async (client) => {
      await lockWriteScope(client, context, branch.id);
      const movement = await correctStock(client, {
        ...input,
        businessId: context.businessId,
        branchId: branch.id,
        productId,
        userId: context.userId,
      });
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "inventory.stock_corrected",
        entityType: "stock_movement",
        entityId: movement.id,
        details: {
          branch_id: branch.id,
          product_id: productId,
          quantity_delta: movement.quantityDelta,
          previous_quantity: movement.previousQuantity,
          new_quantity: movement.newQuantity,
          total_cost: movement.totalCost ?? 0,
          reason: movement.reason,
        },
      });
      return movement;
    });
  } catch (cause) {
    raiseInventoryRule(cause);
  }
}

export async function receiveBusinessStock(
  context: AuthenticatedContext,
  productId: string,
  input: StockReceiptInput,
) {
  requirePermission(context, "inventory.manage");
  const branch = await resolveBranch(context, input.branchId);
  try {
    return await withTransaction(async (client) => {
      await lockWriteScope(client, context, branch.id);
      const movement = await receiveStock(client, {
        ...input,
        businessId: context.businessId,
        branchId: branch.id,
        productId,
        userId: context.userId,
      });
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "inventory.stock_received",
        entityType: "stock_movement",
        entityId: movement.id,
        details: {
          branch_id: branch.id,
          product_id: productId,
          quantity: movement.quantityDelta,
          unit_cost: movement.unitCost ?? 0,
          total_cost: movement.totalCost ?? 0,
          reference_id: movement.referenceId,
          reason: movement.reason,
        },
      });

      if (input.newSellingPrice !== undefined && input.newSellingPrice !== null) {
        const priceUpdate = await updateBaseSellingPrice(
          client,
          context.businessId,
          productId,
          input.newSellingPrice,
          context.userId,
        );
        if (priceUpdate.changed) {
          await recordAuditLog(client, {
            businessId: context.businessId,
            userId: context.userId,
            action: "catalog.product_base_selling_price_updated",
            entityType: "product",
            entityId: productId,
            details: {
              branch_id: branch.id,
              selling_price: priceUpdate.product.sellingPrice,
              base_unit_id: priceUpdate.product.baseUnitId,
              source: "inventory_receipt",
            },
          });
        }
      }
      return movement;
    });
  } catch (cause) {
    raiseInventoryRule(cause);
  }
}
