import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import type { CustomerDebtPaymentInput } from "@/lib/server/schemas/customer-debt";

import { requirePermission } from "../auth/authorization";
import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { withTransaction } from "../db/transaction";
import { recordAuditLog } from "../repositories/audit-logs";
import {
  getCustomerStatement,
  listCustomerDebts,
  recordCustomerDebtPayment,
  CustomerDebtRuleError,
} from "../repositories/customer-debt";

export async function listBusinessCustomerDebts(context: AuthenticatedContext) {
  requirePermission(context, "customer_debts.read");
  return listCustomerDebts(getDatabasePool(), context.businessId);
}

export async function getBusinessCustomerStatement(
  context: AuthenticatedContext,
  customerId: string,
) {
  requirePermission(context, "customers.read");
  const statement = await getCustomerStatement(getDatabasePool(), context.businessId, customerId);
  if (!statement) {
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
    return await withTransaction(async (client) => {
      const payment = await recordCustomerDebtPayment(
        client,
        context.businessId,
        debtId,
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
