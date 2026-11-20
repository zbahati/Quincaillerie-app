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
import { findBranchForBusiness } from "../repositories/branches";
import { recordAuditLog } from "../repositories/audit-logs";
import {
  assignCashAccountBranch,
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

async function resolveLedgerBranch(
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

async function resolveAssignedLedgerBranch(
  context: AuthenticatedContext,
  requestedBranchId: string,
): Promise<string> {
  const branchId = await resolveLedgerBranch(context, requestedBranchId);
  if (!branchId) {
    throw new AuthServiceError(400, "branch_required", "Select an active branch.");
  }
  return branchId;
}

export async function listBusinessCashAccounts(
  context: AuthenticatedContext,
  requestedBranchId: string | null,
) {
  requirePermission(context, "cash_accounts.balance.read");
  const branchId = await resolveLedgerBranch(context, requestedBranchId, true);
  return listCashAccounts(getDatabasePool(), context.businessId, branchId);
}

export async function createBusinessCashAccount(
  context: AuthenticatedContext,
  input: CashAccountCreateInput,
) {
  requirePermission(context, "cash_accounts.manage");
  const branchId = await resolveAssignedLedgerBranch(context, input.branchId);
  try {
    return await withTransaction(async (client) => {
      const account = await createCashAccount(client, context.businessId, context.userId, {
        ...input,
        branchId,
      });
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

export async function updateBusinessCashAccount(
  context: AuthenticatedContext,
  accountId: string,
  input: { branchId?: string; isActive?: boolean },
) {
  if (context.role !== "admin") {
    throw new AuthServiceError(403, "forbidden", "Only an Admin can assign or activate cash accounts.");
  }
  requirePermission(context, "cash_accounts.manage");
  const branchId = input.branchId
    ? await resolveAssignedLedgerBranch(context, input.branchId)
    : undefined;
  try {
    await withTransaction(async (client) => {
      if (branchId) {
        await assignCashAccountBranch(client, context.businessId, accountId, branchId);
      }
      if (input.isActive !== undefined) {
        await setCashAccountActive(client, context.businessId, accountId, input.isActive);
      }
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "cash_accounts.account_updated",
        entityType: "cash_account",
        entityId: accountId,
        details: {
          ...(branchId ? { branch_id: branchId } : {}),
          ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
        },
      });
    });
  } catch (cause) {
    raiseLedger(cause);
  }
}

export async function listBusinessExpenses(
  context: AuthenticatedContext,
  requestedBranchId: string | null,
  offset: number,
  limit: number,
) {
  requirePermission(context, "expenses.read");
  const branchId = await resolveLedgerBranch(context, requestedBranchId, true);
  return listExpenses(getDatabasePool(), context.businessId, branchId, offset, limit);
}

export async function createBusinessExpense(context: AuthenticatedContext, input: ExpenseCreateInput) {
  requirePermission(context, "expenses.manage");
  const branchId = await resolveAssignedLedgerBranch(context, input.branchId);
  try {
    return await withTransaction(async (client) => {
      const expense = await createExpense(client, context.businessId, context.userId, {
        ...input,
        branchId,
      });
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

export async function listBusinessCashTransfers(
  context: AuthenticatedContext,
  requestedBranchId: string | null,
) {
  requirePermission(context, "cash_accounts.balance.read");
  const branchId = await resolveLedgerBranch(context, requestedBranchId, true);
  return listCashTransfers(getDatabasePool(), context.businessId, branchId);
}

export async function createBusinessCashTransfer(
  context: AuthenticatedContext,
  input: { branchId: string; fromAccountId: string; toAccountId: string; amount: number },
) {
  requirePermission(context, "cash_accounts.manage");
  const branchId = await resolveAssignedLedgerBranch(context, input.branchId);
  try {
    return await withTransaction(async (client) => {
      const transfer = await createCashTransfer(client, context.businessId, context.userId, {
        ...input,
        branchId,
      });
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
  branchId: string,
  confirmationReference: string | null,
) {
  if (context.role !== "admin") {
    throw new AuthServiceError(403, "forbidden", "Only Admin can confirm a cash transfer.");
  }
  requirePermission(context, "cash_accounts.manage");
  const resolvedBranchId = await resolveAssignedLedgerBranch(context, branchId);
  try {
    return await withTransaction(async (client) => {
      const transfer = await confirmCashTransfer(
        client,
        context.businessId,
        transferId,
        context.userId,
        resolvedBranchId,
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
