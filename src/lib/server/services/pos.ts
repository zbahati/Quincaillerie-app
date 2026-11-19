import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import type {
  PosCheckoutInput,
  PosListQuery,
  PosPaymentOptionsQuery,
} from "@/lib/server/schemas/pos";

import { requireBusinessScope, requirePermission } from "../auth/authorization";
import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { withTransaction } from "../db/transaction";
import { recordAuditLog } from "../repositories/audit-logs";
import { findBranchForBusiness, listBranchesForBusiness } from "../repositories/branches";
import { InventoryRuleError } from "../repositories/inventory";
import { LedgerRuleError } from "../repositories/ledger";
import {
  checkoutPosSale,
  listPosPaymentAccounts,
  listPosProducts,
  PosRuleError,
} from "../repositories/pos";

async function resolveBranch(context: AuthenticatedContext, branchId: string) {
  const resolvedId = branchId;
  if (context.role === "manager") {
    if (!context.branchId || resolvedId !== context.branchId) {
      throw new AuthServiceError(403, "forbidden", "You cannot access this branch.");
    }
  }
  const branch = await findBranchForBusiness(getDatabasePool(), context.businessId, resolvedId);
  if (!branch || !branch.isActive) {
    throw new AuthServiceError(404, "branch_not_found", "The selected branch is unavailable.");
  }
  requireBusinessScope(context, context.businessId, branch.id);
  return branch;
}

function raisePosRule(cause: unknown): never {
  if (cause instanceof PosRuleError) {
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

export async function listBusinessPosBranches(context: AuthenticatedContext) {
  requirePermission(context, "pos.use");
  if (context.role === "admin") return listBranchesForBusiness(getDatabasePool(), context.businessId);
  if (!context.branchId) throw new AuthServiceError(403, "forbidden", "A branch assignment is required.");
  const branch = await findBranchForBusiness(getDatabasePool(), context.businessId, context.branchId);
  if (!branch || !branch.isActive) throw new AuthServiceError(403, "forbidden", "Your assigned branch is unavailable.");
  return [branch];
}

export async function listBusinessPosProducts(
  context: AuthenticatedContext,
  query: PosListQuery,
) {
  requirePermission(context, "pos.use");
  const branch = await resolveBranch(context, query.branchId);
  return listPosProducts(getDatabasePool(), context.businessId, branch.id, query);
}

export async function listBusinessPosPaymentAccounts(
  context: AuthenticatedContext,
  query: PosPaymentOptionsQuery,
) {
  requirePermission(context, "pos.use");
  const branch = await resolveBranch(context, query.branchId);
  return listPosPaymentAccounts(getDatabasePool(), context.businessId, branch.id);
}

export async function checkoutBusinessPosSale(
  context: AuthenticatedContext,
  input: PosCheckoutInput,
) {
  requirePermission(context, "pos.use");
  const branch = await resolveBranch(context, input.branchId);
  try {
    return await withTransaction(async (client) => {
      const receipt = await checkoutPosSale(client, {
        ...input,
        businessId: context.businessId,
        userId: context.userId,
      });
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "pos.sale_completed",
        entityType: "sale",
        entityId: receipt.id,
        details: {
          branch_id: branch.id,
          transaction_number: receipt.transactionNumber,
          total: receipt.total,
          amount_paid: receipt.amountPaid,
          balance_due: receipt.balanceDue,
          customer_id: input.customerId ?? null,
          payments: input.payments.map((payment) => ({
            payment_method: payment.paymentMethod,
            amount: payment.amount,
            cash_account_id: payment.cashAccountId,
          })),
        },
      });
      return receipt;
    });
  } catch (cause) {
    raisePosRule(cause);
  }
}
