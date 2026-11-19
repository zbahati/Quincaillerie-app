import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface CashAccount {
  id: string;
  business_id: string;
  branch_id: string | null;
  account_type: "cash_drawer" | "bank" | "mtn_wallet" | "airtel_wallet" | "other";
  name: string;
  responsible_user_id: string | null;
  responsible_name: string | null;
  is_active: boolean;
  opening_amount: number | null;
  available_balance: number | null;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  business_id: string;
  branch_id: string | null;
  category: string;
  amount: number;
  expense_date: string;
  payment_method: string;
  cash_account_id: string | null;
  description: string;
  responsible_name: string;
  created_at: string;
}

export interface CashTransfer {
  id: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  status: "pending" | "confirmed" | "cancelled";
  occurred_at: string;
  confirmation_reference: string | null;
  confirmed_at: string | null;
  created_at: string;
}

export const ledgerApi = {
  async accounts(): Promise<CashAccount[]> {
    const value = await requestJson("/api/cash-accounts");
    if (!isRecord(value) || !Array.isArray(value.accounts)) throw invalidResponse("Invalid cash accounts.");
    return value.accounts as unknown as CashAccount[];
  },
  async createAccount(input: { branchId: string | null; accountType: string; name: string }): Promise<CashAccount> {
    const value = await requestJson("/api/cash-accounts", { method: "POST", body: JSON.stringify(input) });
    if (!isRecord(value) || !isRecord(value.account)) throw invalidResponse("Invalid cash account response.");
    return value.account as unknown as CashAccount;
  },
  async openAccount(accountId: string, openingAmount: number): Promise<CashAccount> {
    const value = await requestJson(`/api/cash-accounts/${encodeURIComponent(accountId)}/opening`, {
      method: "POST",
      body: JSON.stringify({ openingAmount }),
    });
    if (!isRecord(value) || !isRecord(value.account)) throw invalidResponse("Invalid opening response.");
    return value.account as unknown as CashAccount;
  },
  async expenses(offset = 0, limit = 20): Promise<{ items: Expense[]; total_count: number }> {
    const value = await requestJson(`/api/expenses?offset=${offset}&limit=${limit}`);
    if (!isRecord(value) || !Array.isArray(value.items) || typeof value.total_count !== "number") {
      throw invalidResponse("Invalid expense response.");
    }
    return value as unknown as { items: Expense[]; total_count: number };
  },
  async createExpense(input: {
    branchId: string | null;
    category: string;
    amount: number;
    expenseDate: string;
    paymentMethod: string;
    cashAccountId: string;
    description: string;
    responsibleName: string;
  }): Promise<Expense> {
    const value = await requestJson("/api/expenses", { method: "POST", body: JSON.stringify(input) });
    if (!isRecord(value) || !isRecord(value.expense)) throw invalidResponse("Invalid expense response.");
    return value.expense as unknown as Expense;
  },
  async transfers(): Promise<CashTransfer[]> {
    const value = await requestJson("/api/cash-transfers");
    if (!isRecord(value) || !Array.isArray(value.transfers)) throw invalidResponse("Invalid cash transfers.");
    return value.transfers as unknown as CashTransfer[];
  },
  async createTransfer(input: { fromAccountId: string; toAccountId: string; amount: number }): Promise<CashTransfer> {
    const value = await requestJson("/api/cash-transfers", { method: "POST", body: JSON.stringify(input) });
    if (!isRecord(value) || !isRecord(value.transfer)) throw invalidResponse("Invalid cash transfer response.");
    return value.transfer as unknown as CashTransfer;
  },
  async confirmTransfer(transferId: string, confirmationReference: string | null): Promise<CashTransfer> {
    const value = await requestJson(`/api/cash-transfers/${encodeURIComponent(transferId)}/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirmationReference }),
    });
    if (!isRecord(value) || !isRecord(value.transfer)) throw invalidResponse("Invalid transfer confirmation.");
    return value.transfer as unknown as CashTransfer;
  },
};
