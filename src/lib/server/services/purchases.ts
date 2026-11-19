import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import type {
  PurchaseCreateInput,
  PurchaseHistoryQuery,
  PurchasePaymentInput,
  PurchaseReceiptInput,
} from "@/lib/server/schemas/purchases";

import { requireBusinessScope, requirePermission } from "../auth/authorization";
import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { withTransaction } from "../db/transaction";
import { recordAuditLog } from "../repositories/audit-logs";
import { findBranchForBusiness, listBranchesForBusiness } from "../repositories/branches";
import { InventoryRuleError } from "../repositories/inventory";
import { LedgerRuleError } from "../repositories/ledger";
import {
  createPurchase,
  findPurchase,
  listPurchaseHistory,
  listPurchasePaymentOptions,
  listPurchaseProducts,
  listPurchases,
  PurchaseRuleError,
  recordPurchasePayment,
  receivePurchase,
} from "../repositories/purchases";

function raisePurchaseRule(cause: unknown): never {
  if (cause instanceof PurchaseRuleError) {
    throw new AuthServiceError(cause.status, cause.code, cause.message);
  }
  if (cause instanceof InventoryRuleError) {
    throw new AuthServiceError(cause.status, cause.code, cause.message);
  }
  if (cause instanceof LedgerRuleError) {
    throw new AuthServiceError(cause.status, cause.code, cause.message);
  }
  throw cause;
}

async function resolveBranch(context: AuthenticatedContext, branchId?: string) {
  let resolvedId = branchId;
  if (context.role === "manager") {
    if (!context.branchId || (resolvedId && resolvedId !== context.branchId)) {
      throw new AuthServiceError(403, "forbidden", "You cannot access this branch.");
    }
    resolvedId = context.branchId;
  } else if (!resolvedId) {
    throw new AuthServiceError(400, "branch_required", "Select a branch for purchases.");
  }

  const branch = await findBranchForBusiness(getDatabasePool(), context.businessId, resolvedId);
  if (!branch) {
    throw new AuthServiceError(404, "branch_not_found", "The branch is unavailable to this business.");
  }
  requireBusinessScope(context, context.businessId, branch.id);
  if (!branch.isActive) {
    throw new AuthServiceError(403, "branch_inactive", "This branch is inactive.");
  }
  return branch;
}

export async function listBusinessPurchaseBranches(context: AuthenticatedContext) {
  requirePermission(context, "purchases.read");
  if (context.role === "admin") return listBranchesForBusiness(getDatabasePool(), context.businessId);
  if (!context.branchId) {
    throw new AuthServiceError(403, "forbidden", "A branch assignment is required.");
  }
  const branch = await findBranchForBusiness(getDatabasePool(), context.businessId, context.branchId);
  if (!branch || !branch.isActive) {
    throw new AuthServiceError(403, "forbidden", "Your assigned branch is unavailable.");
  }
  return [branch];
}

export async function listBusinessPurchaseProducts(context: AuthenticatedContext) {
  requirePermission(context, "purchases.read");
  return listPurchaseProducts(getDatabasePool(), context.businessId);
}

export async function listBusinessPurchases(context: AuthenticatedContext, branchId: string) {
  requirePermission(context, "purchases.read");
  const branch = await resolveBranch(context, branchId);
  return listPurchases(getDatabasePool(), context.businessId, branch.id);
}

export async function listBusinessPurchaseHistory(
  context: AuthenticatedContext,
  input: PurchaseHistoryQuery,
) {
  requirePermission(context, "purchases.read");
  const branch = await resolveBranch(context, input.branchId);
  return listPurchaseHistory(getDatabasePool(), context.businessId, {
    ...input,
    branchId: branch.id,
  });
}

export async function listBusinessPurchasePaymentOptions(
  context: AuthenticatedContext,
  branchId: string,
) {
  requirePermission(context, "purchases.manage");
  requirePermission(context, "cash_accounts.balance.read");
  const branch = await resolveBranch(context, branchId);
  try {
    return await listPurchasePaymentOptions(getDatabasePool(), context.businessId, branch.id);
  } catch (cause) {
    raisePurchaseRule(cause);
  }
}

export async function createBusinessPurchase(context: AuthenticatedContext, input: PurchaseCreateInput) {
  requirePermission(context, "purchases.manage");
  const branch = await resolveBranch(context, input.branchId);
  try {
    return await withTransaction(async (client) => {
      const purchase = await createPurchase(client, context.businessId, branch.id, input);
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "purchases.purchase_created",
        entityType: "purchase",
        entityId: purchase.id,
        details: {
          branch_id: branch.id,
          supplier_id: purchase.supplierId,
          invoice_number: purchase.supplierInvoiceNumber,
          subtotal: purchase.subtotal,
          duplicate_authorized: purchase.duplicateAuthorized,
        },
      });
      return purchase;
    });
  } catch (cause) {
    raisePurchaseRule(cause);
  }
}

export async function receiveBusinessPurchase(
  context: AuthenticatedContext,
  purchaseId: string,
  input: PurchaseReceiptInput,
) {
  requirePermission(context, "purchases.manage");
  const branch = await resolveBranch(context, input.branchId);
  try {
    return await withTransaction(async (client) => {
      const receipt = await receivePurchase(client, {
        ...input,
        branchId: branch.id,
        businessId: context.businessId,
        purchaseId,
        userId: context.userId,
      });
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "purchases.delivery_received",
        entityType: "purchase_receipt",
        entityId: receipt.id,
        details: {
          branch_id: branch.id,
          purchase_id: purchaseId,
          delivery_reference: receipt.deliveryReference,
          total_cost: receipt.totalCost,
          status: receipt.status,
        },
      });
      return receipt;
    });
  } catch (cause) {
    raisePurchaseRule(cause);
  }
}

export async function recordBusinessPurchasePayment(
  context: AuthenticatedContext,
  purchaseId: string,
  input: PurchasePaymentInput,
) {
  requirePermission(context, "purchases.manage");
  const branch = await resolveBranch(context, input.branchId);
  try {
    return await withTransaction(async (client) => {
      const purchase = await recordPurchasePayment(client, {
        ...input,
        branchId: branch.id,
        businessId: context.businessId,
        purchaseId,
        userId: context.userId,
      });
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "purchases.supplier_payment_recorded",
        entityType: "purchase",
        entityId: purchaseId,
        details: {
          branch_id: branch.id,
          amount: input.amount,
          payment_method: input.paymentMethod,
          cash_account_id: input.cashAccountId,
          supplier_id: purchase.supplierId,
          invoice_number: purchase.supplierInvoiceNumber,
        },
      });
      return purchase;
    });
  } catch (cause) {
    raisePurchaseRule(cause);
  }
}

export async function getBusinessPurchase(
  context: AuthenticatedContext,
  branchId: string,
  purchaseId: string,
) {
  requirePermission(context, "purchases.read");
  const branch = await resolveBranch(context, branchId);
  const purchase = await findPurchase(getDatabasePool(), context.businessId, branch.id, purchaseId);
  if (!purchase) {
    throw new AuthServiceError(404, "purchase_not_found", "The purchase is unavailable to this branch.");
  }
  return purchase;
}
