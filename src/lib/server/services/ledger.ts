import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import type {
  CashAccountCreateInput,
  CashAccountOpeningInput,
  ExpenseCreateInput,
} from "@/lib/server/schemas/ledger";

import { requirePermission } from "../auth/authorization";
import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { withTransaction } from "../db/transaction";
import { recordAuditLog } from "../repositories/audit-logs";
import {
  createCashAccount,
  createExpense,
  createCashTransfer,
  confirmCashTransfer,
  LedgerRuleError,
  listCashAccounts,
  listExpenses,
  listCashTransfers,
  openCashAccount,
  setCashAccountActive,
} from "../repositories/ledger";

function raiseLedger(cause: unknown): never {
  if (cause instanceof LedgerRuleError) {
    throw new AuthServiceError(cause.status, cause.code, cause.message);
  }
  throw cause;
}

export async function listBusinessCashAccounts(context: AuthenticatedContext) {
  requirePermission(context, "cash_accounts.balance.read");
  return listCashAccounts(getDatabasePool(), context.businessId);
}

export async function createBusinessCashAccount(
  context: AuthenticatedContext,
  input: CashAccountCreateInput,
) {
  requirePermission(context, "cash_accounts.manage");
  try {
    return await withTransaction(async (client) => {
      const account = await createCashAccount(client, context.businessId, context.userId, input);
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "cash_accounts.account_created",
        entityType: "cash_account",
        entityId: account.id,
        details: { name: account.name, account_type: account.accountType },
      });
      return account;
    });
  } catch (cause) {
    raiseLedger(cause);
  }
}

export async function openBusinessCashAccount(
  context: AuthenticatedContext,
  accountId: string,
  input: CashAccountOpeningInput,
) {
  if (context.role !== "admin") {
    throw new AuthServiceError(403, "forbidden", "Only Admin can authorize a cash account opening.");
  }
  requirePermission(context, "cash_accounts.manage");
  try {
    return await withTransaction(async (client) => {
      const account = await openCashAccount(client, context.businessId, accountId, context.userId, input);
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "cash_accounts.opening_recorded",
        entityType: "cash_account",
        entityId: account.id,
        details: { opening_amount: input.openingAmount },
      });
      return account;
    });
  } catch (cause) {
    raiseLedger(cause);
  }
}

export async function setBusinessCashAccountActive(
  context: AuthenticatedContext,
  accountId: string,
  isActive: boolean,
) {
  requirePermission(context, "cash_accounts.manage");
  try {
    await withTransaction(async (client) => {
      await setCashAccountActive(client, context.businessId, accountId, isActive);
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "cash_accounts.active_changed",
        entityType: "cash_account",
        entityId: accountId,
        details: { is_active: isActive },
      });
    });
  } catch (cause) {
    raiseLedger(cause);
  }
}

export async function listBusinessExpenses(context: AuthenticatedContext, offset: number, limit: number) {
  requirePermission(context, "expenses.read");
  return listExpenses(getDatabasePool(), context.businessId, offset, limit);
}

export async function createBusinessExpense(context: AuthenticatedContext, input: ExpenseCreateInput) {
  requirePermission(context, "expenses.manage");
  try {
    return await withTransaction(async (client) => {
      const expense = await createExpense(client, context.businessId, context.userId, input);
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "expenses.expense_created",
        entityType: "expense",
        entityId: expense.id,
        details: {
          category: expense.category,
          amount: expense.amount,
          payment_method: expense.paymentMethod,
          cash_account_id: expense.cashAccountId,
        },
      });
      return expense;
    });
  } catch (cause) {
    raiseLedger(cause);
  }
}

export async function listBusinessCashTransfers(context: AuthenticatedContext) {
  requirePermission(context, "cash_accounts.balance.read");
  return listCashTransfers(getDatabasePool(), context.businessId);
}

export async function createBusinessCashTransfer(
  context: AuthenticatedContext,
  input: { fromAccountId: string; toAccountId: string; amount: number },
) {
  requirePermission(context, "cash_accounts.manage");
  try {
    return await withTransaction(async (client) => {
      const transfer = await createCashTransfer(client, context.businessId, context.userId, input);
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "cash_accounts.transfer_initiated",
        entityType: "cash_transfer",
        entityId: transfer.id,
        details: {
          from_account_id: transfer.fromAccountId,
          to_account_id: transfer.toAccountId,
          amount: transfer.amount,
        },
      });
      return transfer;
    });
  } catch (cause) {
    raiseLedger(cause);
  }
}

export async function confirmBusinessCashTransfer(
  context: AuthenticatedContext,
  transferId: string,
  confirmationReference: string | null,
) {
  if (context.role !== "admin") {
    throw new AuthServiceError(403, "forbidden", "Only Admin can confirm a cash transfer.");
  }
  requirePermission(context, "cash_accounts.manage");
  try {
    return await withTransaction(async (client) => {
      const transfer = await confirmCashTransfer(
        client,
        context.businessId,
        transferId,
        context.userId,
        confirmationReference,
      );
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "cash_accounts.transfer_confirmed",
        entityType: "cash_transfer",
        entityId: transfer.id,
        details: {
          from_account_id: transfer.fromAccountId,
          to_account_id: transfer.toAccountId,
          amount: transfer.amount,
          confirmation_reference: transfer.confirmationReference,
        },
      });
      return transfer;
    });
  } catch (cause) {
    raiseLedger(cause);
  }
}
