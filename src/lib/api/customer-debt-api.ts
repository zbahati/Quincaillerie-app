import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface CustomerDebt {
  id: string;
  branch_id: string;
  customer_id: string;
  customer_name: string;
  sale_id: string;
  transaction_number: string;
  original_amount: number;
  amount_paid: number;
  balance_due: number;
  created_at: string;
}

export interface CustomerDebtPaymentAccount {
  id: string;
  account_type: "cash_drawer" | "bank" | "mtn_wallet" | "airtel_wallet";
  name: string;
}

export interface CustomerStatementEntry {
  id: string;
  transaction_number: string;
  entry_type: "sale" | "sale_payment" | "repayment";
  payment_method: string | null;
  amount: number;
  balance_after: number;
  created_at: string;
}

export interface CustomerStatement {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    branch_id: string | null;
    customer_type: "individual" | "business";
    credit_limit: number;
  };
  total_sales: number;
  total_payments: number;
  outstanding_balance: number;
  entries: CustomerStatementEntry[];
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isPaymentAccountType(
  value: unknown,
): value is CustomerDebtPaymentAccount["account_type"] {
  return value === "cash_drawer" ||
    value === "bank" ||
    value === "mtn_wallet" ||
    value === "airtel_wallet";
}

export const customerDebtApi = {
  async list(branchId: string): Promise<CustomerDebt[]> {
    const value = await requestJson(`/api/customer-debt?branchId=${encodeURIComponent(branchId)}`);
    if (!isRecord(value) || !Array.isArray(value.debts)) {
      throw invalidResponse("The service returned invalid customer debts.");
    }
    return value.debts.map((debt) => {
      if (
        !isRecord(debt) ||
        typeof debt.id !== "string" ||
        typeof debt.branch_id !== "string" ||
        typeof debt.customer_id !== "string" ||
        typeof debt.customer_name !== "string" ||
        typeof debt.sale_id !== "string" ||
        typeof debt.transaction_number !== "string" ||
        !safeInteger(debt.original_amount) ||
        !safeInteger(debt.amount_paid) ||
        !safeInteger(debt.balance_due) ||
        typeof debt.created_at !== "string"
      ) {
        throw invalidResponse("The service returned invalid customer debt information.");
      }
      return debt as unknown as CustomerDebt;
    });
  },
  async paymentAccounts(branchId: string): Promise<CustomerDebtPaymentAccount[]> {
    const value = await requestJson(
      `/api/customer-debt/payment-options?branchId=${encodeURIComponent(branchId)}`,
    );
    if (!isRecord(value) || !Array.isArray(value.accounts)) {
      throw invalidResponse("The service returned invalid customer payment accounts.");
    }
    return value.accounts.map((account) => {
      if (
        !isRecord(account) ||
        typeof account.id !== "string" ||
        typeof account.name !== "string" ||
        !isPaymentAccountType(account.account_type)
      ) {
        throw invalidResponse("The service returned invalid customer payment-account information.");
      }
      return {
        id: account.id,
        name: account.name,
        account_type: account.account_type,
      };
    });
  },
  async repay(
    debtId: string,
    input: {
      branchId: string;
      paymentMethod: "cash" | "mtn_mobile_money" | "airtel_money" | "bank_transfer";
      amount: number;
      cashAccountId: string;
    },
  ): Promise<{
    id: string;
    customer_name: string;
    payment_method: string;
    amount: number;
    balance_due: number;
    cash_account_id: string;
  }> {
    const value = await requestJson(`/api/customer-debt/${encodeURIComponent(debtId)}/payment`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!isRecord(value) || !isRecord(value.payment)) {
      throw invalidResponse("The service returned an invalid repayment.");
    }
    const payment = value.payment;
    if (
      typeof payment.id !== "string" ||
      typeof payment.customer_name !== "string" ||
      typeof payment.payment_method !== "string" ||
      !safeInteger(payment.amount) ||
      !safeInteger(payment.balance_due) ||
      typeof payment.cash_account_id !== "string"
    ) {
      throw invalidResponse("The service returned invalid repayment information.");
    }
    return {
      id: payment.id,
      customer_name: payment.customer_name,
      payment_method: payment.payment_method,
      amount: payment.amount,
      balance_due: payment.balance_due,
      cash_account_id: payment.cash_account_id,
    };
  },
  async statement(customerId: string, branchId: string): Promise<CustomerStatement> {
    const value = await requestJson(`/api/customers/${encodeURIComponent(customerId)}/statement?branchId=${encodeURIComponent(branchId)}`);
    if (!isRecord(value)) {
      throw invalidResponse("The service returned an invalid customer statement.");
    }
    return value as unknown as CustomerStatement;
  },
};
