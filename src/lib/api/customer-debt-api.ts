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
  async repay(debtId: string, input: { branchId: string; paymentMethod: "cash" | "mtn_mobile_money" | "airtel_money" | "bank_transfer"; amount: number }): Promise<{ id: string; customer_name: string; payment_method: string; amount: number; balance_due: number }> {
    const value = await requestJson(`/api/customer-debt/${encodeURIComponent(debtId)}/payment`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!isRecord(value) || !isRecord(value.payment)) {
      throw invalidResponse("The service returned an invalid repayment.");
    }
    return value.payment as unknown as { id: string; customer_name: string; payment_method: string; amount: number; balance_due: number };
  },
  async statement(customerId: string, branchId: string): Promise<CustomerStatement> {
    const value = await requestJson(`/api/customers/${encodeURIComponent(customerId)}/statement?branchId=${encodeURIComponent(branchId)}`);
    if (!isRecord(value)) {
      throw invalidResponse("The service returned an invalid customer statement.");
    }
    return value as unknown as CustomerStatement;
  },
};
