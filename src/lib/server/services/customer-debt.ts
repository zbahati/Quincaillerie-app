import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import type { CustomerDebtPaymentInput } from "@/lib/server/schemas/customer-debt";

import { requirePermission } from "../auth/authorization";
import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { withTransaction } from "../db/transaction";
import { findBranchForBusiness } from "../repositories/branches";
import { recordAuditLog } from "../repositories/audit-logs";
import {
  getCustomerStatement,
  listCustomerDebts,
  recordCustomerDebtPayment,
  CustomerDebtRuleError,
} from "../repositories/customer-debt";

async function resolveCustomerDebtBranch(
  context: AuthenticatedContext,
  requestedBranchId?: string,
): Promise<string> {
  let branchId = requestedBranchId;
  if (context.role === "manager") {
    if (!context.branchId || (requestedBranchId && requestedBranchId !== context.branchId)) {
      throw new AuthServiceError(403, "forbidden", "You cannot access this branch.");
    }
    branchId = context.branchId;
  }
  if (!branchId) {
    throw new AuthServiceError(400, "branch_required", "Select an active branch.");
  }
  const branch = await findBranchForBusiness(getDatabasePool(), context.businessId, branchId);
  if (!branch || !branch.isActive) {
    throw new AuthServiceError(404, "branch_not_found", "The selected branch is unavailable.");
  }
  return branch.id;
}

export async function listBusinessCustomerDebts(
  context: AuthenticatedContext,
  requestedBranchId?: string,
) {
  requirePermission(context, "customer_debts.read");
  const branchId = await resolveCustomerDebtBranch(context, requestedBranchId);
  return listCustomerDebts(getDatabasePool(), context.businessId, branchId);
}

export async function getBusinessCustomerStatement(
  context: AuthenticatedContext,
  customerId: string,
  requestedBranchId?: string,
) {
  requirePermission(context, "customers.read");
  const branchId = await resolveCustomerDebtBranch(context, requestedBranchId);
  const statement = await getCustomerStatement(getDatabasePool(), context.businessId, customerId);
  if (!statement || statement.customer.branchId !== branchId) {
    throw new AuthServiceError(404, "customer_not_found", "The customer is unavailable to this business.");
  }
  return statement;
}

export async function recordBusinessCustomerDebtPayment(
  context: AuthenticatedContext,
  debtId: string,
  input: CustomerDebtPaymentInput,
) {
  requirePermission(context, "customer_payments.manage");
  try {
    const branchId = await resolveCustomerDebtBranch(context, input.branchId);
    return await withTransaction(async (client) => {
      const payment = await recordCustomerDebtPayment(
        client,
        context.businessId,
        debtId,
        branchId,
        input,
      );
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "customer_debt.repayment_recorded",
        entityType: "customer_debt_payment",
        entityId: payment.paymentId,
        details: {
          debt_id: debtId,
          payment_method: input.paymentMethod,
          amount: input.amount,
          balance_due: payment.balanceDue,
          branch_id: branchId,
        },
      });
      return payment;
    });
  } catch (cause) {
    if (cause instanceof CustomerDebtRuleError) {
      throw new AuthServiceError(cause.status, cause.code, cause.message);
    }
    throw cause;
  }
}
