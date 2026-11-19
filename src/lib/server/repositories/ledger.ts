import "server-only";

import type { Pool, PoolClient } from "pg";
import type {
  CashAccountCreateInput,
  CashAccountOpeningInput,
  ExpenseCreateInput,
} from "@/lib/server/schemas/ledger";

export type LedgerExecutor = Pool | PoolClient;

export class LedgerRuleError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "LedgerRuleError";
  }
}

export interface CashAccountRecord {
  id: string;
  businessId: string;
  branchId: string | null;
  accountType: "cash_drawer" | "bank" | "mtn_wallet" | "airtel_wallet" | "other";
  name: string;
  responsibleUserId: string | null;
  responsibleName: string | null;
  isActive: boolean;
  openingAmount: number | null;
  availableBalance: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CashPaymentMethod = "cash" | "mtn_mobile_money" | "airtel_money" | "bank_transfer";

export interface OpenedCashPaymentAccount {
  id: string;
  accountType: Exclude<CashAccountRecord["accountType"], "other">;
  name: string;
}

export interface ExpenseRecord {
  id: string;
  businessId: string;
  branchId: string | null;
  category: string;
  amount: number;
  expenseDate: string;
  paymentMethod: string;
  cashAccountId: string | null;
  description: string;
  responsibleName: string;
  createdAt: Date;
}

export interface CashTransferRecord {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  status: "pending" | "confirmed" | "cancelled";
  occurredAt: Date;
  initiatedByUserId: string;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
  cancelledByUserId: string | null;
  cancelledAt: Date | null;
  confirmationReference: string | null;
  createdAt: Date;
}

export function cashAccountTypeForPaymentMethod(
  method: CashPaymentMethod,
): OpenedCashPaymentAccount["accountType"] {
  switch (method) {
    case "cash": return "cash_drawer";
    case "bank_transfer": return "bank";
    case "mtn_mobile_money": return "mtn_wallet";
    case "airtel_money": return "airtel_wallet";
  }
}

function safeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`The stored ${field} exceeds the browser's safe integer range.`);
  }
  return parsed;
}

export async function accountBalance(executor: LedgerExecutor, businessId: string, accountId: string): Promise<number | null> {
  const opening = await executor.query<{ amount: string }>(
    `SELECT opening_amount::text AS amount
     FROM cash_account_openings
     WHERE business_id = $1 AND account_id = $2`,
    [businessId, accountId],
  );
  if (opening.rowCount !== 1) return null;
  const movements = await executor.query<{ direction: "in" | "out"; amount: string }>(
    `SELECT direction, amount::text AS amount
     FROM cash_movements
     WHERE business_id = $1 AND account_id = $2
     ORDER BY recorded_at, id`,
    [businessId, accountId],
  );
  let balance = safeInteger(opening.rows[0].amount, "cash account opening");
  for (const movement of movements.rows) {
    const amount = safeInteger(movement.amount, "cash account movement");
    balance = movement.direction === "in" ? balance + amount : balance - amount;
    if (!Number.isSafeInteger(balance) || balance < 0) {
      throw new LedgerRuleError(400, "invalid_cash_balance", "The cash account balance is outside the supported range.");
    }
  }
  return balance;
}

export async function listOpenedCashAccountsForBranch(
  executor: LedgerExecutor,
  businessId: string,
  branchId: string,
): Promise<OpenedCashPaymentAccount[]> {
  const result = await executor.query<OpenedCashPaymentAccount>(
    `SELECT a.id, a.account_type AS "accountType", a.name
     FROM cash_accounts a
     JOIN cash_account_openings o
       ON o.business_id = a.business_id AND o.account_id = a.id
     WHERE a.business_id = $1 AND a.is_active = TRUE
       AND a.account_type IN ('cash_drawer', 'bank', 'mtn_wallet', 'airtel_wallet')
       AND (a.branch_id IS NULL OR a.branch_id = $2)
     ORDER BY a.account_type, lower(a.name), a.id`,
    [businessId, branchId],
  );
  return result.rows;
}

export async function lockOpenedCashAccountForPayment(
  client: PoolClient,
  businessId: string,
  branchId: string,
  accountId: string,
  paymentMethod: CashPaymentMethod,
): Promise<void> {
  const result = await client.query<{
    accountType: CashAccountRecord["accountType"];
    branchId: string | null;
    isActive: boolean;
    isOpened: boolean;
  }>(
    `SELECT a.account_type AS "accountType", a.branch_id AS "branchId",
            a.is_active AS "isActive", o.account_id IS NOT NULL AS "isOpened"
     FROM cash_accounts a
     LEFT JOIN cash_account_openings o
       ON o.business_id = a.business_id AND o.account_id = a.id
     WHERE a.business_id = $1 AND a.id = $2
     FOR UPDATE OF a`,
    [businessId, accountId],
  );
  if (result.rowCount !== 1 || !result.rows[0].isActive) {
    throw new LedgerRuleError(404, "cash_account_not_found", "The selected cash account is unavailable.");
  }
  const account = result.rows[0];
  if (account.branchId !== null && account.branchId !== branchId) {
    throw new LedgerRuleError(403, "cash_account_branch_mismatch", "The selected cash account is not available to this branch.");
  }
  if (account.accountType !== cashAccountTypeForPaymentMethod(paymentMethod)) {
    throw new LedgerRuleError(400, "payment_account_mismatch", "The account does not match the payment method.");
  }
  if (!account.isOpened) {
    throw new LedgerRuleError(400, "cash_account_not_opened", "Set an authorized opening balance before using this account.");
  }
}

export async function listCashAccounts(executor: LedgerExecutor, businessId: string): Promise<CashAccountRecord[]> {
  const result = await executor.query<{
    id: string;
    businessId: string;
    branchId: string | null;
    accountType: CashAccountRecord["accountType"];
    name: string;
    responsibleUserId: string | null;
    responsibleName: string | null;
    isActive: boolean;
    openingAmount: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT a.id, a.business_id AS "businessId", a.branch_id AS "branchId",
            a.account_type AS "accountType", a.name,
            a.responsible_user_id AS "responsibleUserId", u.full_name AS "responsibleName",
            a.is_active AS "isActive", o.opening_amount::text AS "openingAmount",
            a.created_at AS "createdAt", a.updated_at AS "updatedAt"
     FROM cash_accounts a
     LEFT JOIN users u ON u.business_id = a.business_id AND u.id = a.responsible_user_id
     LEFT JOIN cash_account_openings o ON o.business_id = a.business_id AND o.account_id = a.id
     WHERE a.business_id = $1
     ORDER BY a.is_active DESC, a.account_type, lower(a.name), a.id`,
    [businessId],
  );
  const accounts: CashAccountRecord[] = [];
  for (const row of result.rows) {
    const openingAmount = row.openingAmount === null ? null : safeInteger(row.openingAmount, "cash account opening");
    accounts.push({
      ...row,
      openingAmount,
      availableBalance: await accountBalance(executor, businessId, row.id),
    });
  }
  return accounts;
}

export async function createCashAccount(
  client: PoolClient,
  businessId: string,
  userId: string,
  input: CashAccountCreateInput,
): Promise<CashAccountRecord> {
  if (input.accountType === "cash_drawer") {
    // Cash drawers may be business-wide until the later Manager branch-ledger slice.
  }
  const result = await client.query<{
    id: string;
  }>(
    `INSERT INTO cash_accounts
       (business_id, branch_id, account_type, name, responsible_user_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      businessId,
      input.accountType === "cash_drawer" ? input.branchId : null,
      input.accountType,
      input.name,
      input.accountType === "cash_drawer" ? userId : null,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("PostgreSQL did not return the cash account.");
  const accounts = await listCashAccounts(client, businessId);
  const account = accounts.find((item) => item.id === id);
  if (!account) throw new Error("PostgreSQL did not return the created cash account.");
  return account;
}

export async function openCashAccount(
  client: PoolClient,
  businessId: string,
  accountId: string,
  userId: string,
  input: CashAccountOpeningInput,
): Promise<CashAccountRecord> {
  const account = await client.query<{ id: string; isActive: boolean }>(
    `SELECT id, is_active AS "isActive"
     FROM cash_accounts
     WHERE business_id = $1 AND id = $2
     FOR UPDATE`,
    [businessId, accountId],
  );
  if (account.rowCount !== 1 || !account.rows[0].isActive) {
    throw new LedgerRuleError(404, "cash_account_not_found", "The cash account is unavailable.");
  }
  const existing = await client.query(
    `SELECT id FROM cash_account_openings
     WHERE business_id = $1 AND account_id = $2
     FOR UPDATE`,
    [businessId, accountId],
  );
  if (existing.rowCount) {
    throw new LedgerRuleError(409, "cash_account_already_opened", "This cash account opening balance is already recorded.");
  }
  await client.query(
    `INSERT INTO cash_account_openings
       (business_id, account_id, opening_amount, entered_by_user_id, authorized_by_user_id)
     VALUES ($1, $2, $3, $4, $4)`,
    [businessId, accountId, input.openingAmount, userId],
  );
  const accounts = await listCashAccounts(client, businessId);
  const updated = accounts.find((item) => item.id === accountId);
  if (!updated) throw new Error("PostgreSQL did not return the opened cash account.");
  return updated;
}

export async function setCashAccountActive(
  client: PoolClient,
  businessId: string,
  accountId: string,
  isActive: boolean,
): Promise<void> {
  const result = await client.query(
    `UPDATE cash_accounts
     SET is_active = $3, updated_at = now()
     WHERE business_id = $1 AND id = $2`,
    [businessId, accountId, isActive],
  );
  if (result.rowCount !== 1) {
    throw new LedgerRuleError(404, "cash_account_not_found", "The cash account is unavailable.");
  }
}

export async function listExpenses(
  executor: LedgerExecutor,
  businessId: string,
  offset: number,
  limit: number,
): Promise<{ items: ExpenseRecord[]; totalCount: number }> {
  const count = await executor.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM expenses WHERE business_id = $1`,
    [businessId],
  );
  const result = await executor.query<{
    id: string;
    businessId: string;
    branchId: string | null;
    category: string;
    amount: string;
    expenseDate: string;
    paymentMethod: string;
    cashAccountId: string | null;
    description: string;
    responsibleName: string;
    createdAt: Date;
  }>(
    `SELECT id, business_id AS "businessId", branch_id AS "branchId", category,
            amount::text AS amount, expense_date::text AS "expenseDate",
            payment_method AS "paymentMethod", cash_account_id AS "cashAccountId",
            description, responsible_name AS "responsibleName", created_at AS "createdAt"
     FROM expenses
     WHERE business_id = $1
     ORDER BY expense_date DESC, created_at DESC, id
     LIMIT $2 OFFSET $3`,
    [businessId, limit, offset],
  );
  return {
    totalCount: safeInteger(count.rows[0]?.count ?? "0", "expense count"),
    items: result.rows.map((row) => ({
      ...row,
      amount: safeInteger(row.amount, "expense amount"),
    })),
  };
}

export async function createExpense(
  client: PoolClient,
  businessId: string,
  userId: string,
  input: ExpenseCreateInput,
): Promise<ExpenseRecord> {
  const account = await client.query<{
    id: string;
    accountType: string;
    isActive: boolean;
  }>(
    `SELECT id, account_type AS "accountType", is_active AS "isActive"
     FROM cash_accounts
     WHERE business_id = $1 AND id = $2
     FOR UPDATE`,
    [businessId, input.cashAccountId],
  );
  if (account.rowCount !== 1 || !account.rows[0].isActive) {
    throw new LedgerRuleError(404, "cash_account_not_found", "The selected cash account is unavailable.");
  }
  const expectedType =
    input.paymentMethod === "cash" ? "cash_drawer"
    : input.paymentMethod === "mtn_mobile_money" ? "mtn_wallet"
    : input.paymentMethod === "airtel_money" ? "airtel_wallet"
    : "bank";
  if (account.rows[0].accountType !== expectedType) {
    throw new LedgerRuleError(400, "payment_account_mismatch", "The account does not match the payment method.");
  }
  const balance = await accountBalance(client, businessId, input.cashAccountId);
  if (balance === null) {
    throw new LedgerRuleError(400, "cash_account_not_opened", "Set an opening balance before using this account.");
  }
  if (input.amount > balance) {
    throw new LedgerRuleError(400, "insufficient_funds", "Expense exceeds the verified funds in the selected account.");
  }

  const expense = await client.query<{ id: string; createdAt: Date }>(
    `INSERT INTO expenses
       (business_id, branch_id, category, amount, expense_date, payment_method,
        cash_account_id, description, responsible_name)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9)
     RETURNING id, created_at AS "createdAt"`,
    [
      businessId,
      input.branchId ?? null,
      input.category,
      input.amount,
      input.expenseDate,
      input.paymentMethod,
      input.cashAccountId,
      input.description,
      input.responsibleName,
    ],
  );
  const id = expense.rows[0]?.id;
  const createdAt = expense.rows[0]?.createdAt;
  if (!id || !createdAt) throw new Error("PostgreSQL did not return the expense.");
  await client.query(
    `INSERT INTO cash_movements
       (business_id, account_id, movement_type, direction, amount, source_type,
        source_id, responsible_user_id, description)
     VALUES ($1, $2, 'expense_payment', 'out', $3, 'expense_payment', $4, $5, $6)`,
    [businessId, input.cashAccountId, input.amount, id, userId, input.description],
  );
  return {
    id,
    businessId,
    branchId: input.branchId ?? null,
    category: input.category,
    amount: input.amount,
    expenseDate: input.expenseDate,
    paymentMethod: input.paymentMethod,
    cashAccountId: input.cashAccountId,
    description: input.description,
    responsibleName: input.responsibleName,
    createdAt,
  };
}

export async function listCashTransfers(
  executor: LedgerExecutor,
  businessId: string,
): Promise<CashTransferRecord[]> {
  const result = await executor.query<{
    id: string;
    fromAccountId: string;
    toAccountId: string;
    amount: string;
    status: CashTransferRecord["status"];
    occurredAt: Date;
    initiatedByUserId: string;
    confirmedByUserId: string | null;
    confirmedAt: Date | null;
    cancelledByUserId: string | null;
    cancelledAt: Date | null;
    confirmationReference: string | null;
    createdAt: Date;
  }>(
    `SELECT id,
            from_account_id AS "fromAccountId",
            to_account_id AS "toAccountId",
            amount::text AS amount,
            status,
            occurred_at AS "occurredAt",
            initiated_by_user_id AS "initiatedByUserId",
            confirmed_by_user_id AS "confirmedByUserId",
            confirmed_at AS "confirmedAt",
            cancelled_by_user_id AS "cancelledByUserId",
            cancelled_at AS "cancelledAt",
            confirmation_reference AS "confirmationReference",
            created_at AS "createdAt"
     FROM cash_transfers
     WHERE business_id = $1
     ORDER BY occurred_at DESC, created_at DESC, id`,
    [businessId],
  );
  return result.rows.map((row) => ({
    ...row,
    amount: safeInteger(row.amount, "cash transfer amount"),
  }));
}

export async function createCashTransfer(
  client: PoolClient,
  businessId: string,
  userId: string,
  input: { fromAccountId: string; toAccountId: string; amount: number },
): Promise<CashTransferRecord> {
  if (input.fromAccountId === input.toAccountId) {
    throw new LedgerRuleError(400, "invalid_transfer_accounts", "Select two different accounts.");
  }
  for (const accountId of [input.fromAccountId, input.toAccountId]) {
    const account = await client.query(
      `SELECT a.id
       FROM cash_accounts a
       JOIN cash_account_openings o ON o.business_id = a.business_id AND o.account_id = a.id
       WHERE a.business_id = $1 AND a.id = $2 AND a.is_active = TRUE
       FOR SHARE`,
      [businessId, accountId],
    );
    if (account.rowCount !== 1) {
      throw new LedgerRuleError(400, "transfer_account_unavailable", "Both accounts must be active and opened.");
    }
  }
  const balance = await accountBalance(client, businessId, input.fromAccountId);
  if (balance === null || input.amount > balance) {
    throw new LedgerRuleError(400, "insufficient_transfer_funds", "The source account has insufficient funds.");
  }
  const result = await client.query<{
    id: string;
    occurredAt: Date;
    createdAt: Date;
  }>(
    `INSERT INTO cash_transfers
       (business_id, from_account_id, to_account_id, amount, status, occurred_at,
        initiated_by_user_id)
     VALUES ($1, $2, $3, $4, 'pending', now(), $5)
     RETURNING id, occurred_at AS "occurredAt", created_at AS "createdAt"`,
    [businessId, input.fromAccountId, input.toAccountId, input.amount, userId],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    amount: input.amount,
    status: "pending",
    occurredAt: row.occurredAt,
    initiatedByUserId: userId,
    confirmedByUserId: null,
    confirmedAt: null,
    cancelledByUserId: null,
    cancelledAt: null,
    confirmationReference: null,
    createdAt: row.createdAt,
  };
}

export async function confirmCashTransfer(
  client: PoolClient,
  businessId: string,
  transferId: string,
  userId: string,
  confirmationReference: string | null,
): Promise<CashTransferRecord> {
  const transfer = await client.query<{
    id: string;
    fromAccountId: string;
    toAccountId: string;
    amount: string;
    occurredAt: Date;
    initiatedByUserId: string;
    createdAt: Date;
  }>(
    `SELECT id,
            from_account_id AS "fromAccountId",
            to_account_id AS "toAccountId",
            amount::text AS amount,
            occurred_at AS "occurredAt",
            initiated_by_user_id AS "initiatedByUserId",
            created_at AS "createdAt"
     FROM cash_transfers
     WHERE business_id = $1 AND id = $2 AND status = 'pending'
     FOR UPDATE`,
    [businessId, transferId],
  );
  if (transfer.rowCount !== 1) {
    throw new LedgerRuleError(404, "cash_transfer_not_pending", "The transfer is unavailable or already processed.");
  }
  const row = transfer.rows[0];
  const amount = safeInteger(row.amount, "cash transfer amount");
  const accountLock = await client.query<{ id: string }>(
    `SELECT id
     FROM cash_accounts
     WHERE business_id = $1 AND id = ANY($2::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [businessId, [row.fromAccountId, row.toAccountId].sort()],
  );
  if (accountLock.rowCount !== 2) {
    throw new LedgerRuleError(404, "transfer_account_unavailable", "A transfer account is no longer available.");
  }
  const sourceBalance = await accountBalance(client, businessId, row.fromAccountId);
  if (sourceBalance === null || amount > sourceBalance) {
    throw new LedgerRuleError(400, "insufficient_transfer_funds", "The source account has insufficient funds.");
  }
  const confirmedAt = new Date();
  await client.query(
    `UPDATE cash_transfers
     SET status = 'confirmed',
         confirmed_by_user_id = $3,
         confirmed_at = $4,
         confirmation_reference = $5
     WHERE business_id = $1 AND id = $2 AND status = 'pending'`,
    [businessId, transferId, userId, confirmedAt, confirmationReference],
  );
  await client.query(
    `INSERT INTO cash_movements
       (business_id, account_id, movement_type, direction, amount, source_type,
        source_id, responsible_user_id, description)
     VALUES ($1, $2, 'transfer_out', 'out', $3, 'cash_transfer', $4, $5, 'Cash transfer out')`,
    [businessId, row.fromAccountId, amount, transferId, userId],
  );
  await client.query(
    `INSERT INTO cash_movements
       (business_id, account_id, movement_type, direction, amount, source_type,
        source_id, responsible_user_id, description)
     VALUES ($1, $2, 'transfer_in', 'in', $3, 'cash_transfer', $4, $5, 'Cash transfer in')`,
    [businessId, row.toAccountId, amount, transferId, userId],
  );
  return {
    id: row.id,
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    amount,
    status: "confirmed",
    occurredAt: row.occurredAt,
    initiatedByUserId: row.initiatedByUserId,
    confirmedByUserId: userId,
    confirmedAt,
    cancelledByUserId: null,
    cancelledAt: null,
    confirmationReference,
    createdAt: row.createdAt,
  };
}
