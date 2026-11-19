import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface IncomeStatement {
  business_name: string;
  branch_name: string;
  from_date: string;
  to_date: string;
  sale_count: number;
  sales_total: number;
  cost_of_goods_sold: number;
  gross_profit: number;
  expenses_total: number;
  operating_result: number;
  expenses_by_category: Array<{ category: string; amount: number }>;
}

export interface BalanceSheet {
  business_name: string;
  branch_name: string;
  report_date: string;
  cash_accounts: Array<{ accountType: string; name: string; balance: number }>;
  cash_and_bank: number;
  inventory: number;
  accounts_receivable: number;
  total_assets: number;
  accounts_payable: number;
  total_liabilities: number;
  retained_earnings: number;
  owner_equity: number;
  total_equity: number;
  total_liabilities_and_equity: number;
  balance_difference: number;
  is_arithmetically_balanced: boolean;
}

export const financialStatementsApi = {
  async income(branchId: string, fromDate: string, toDate: string): Promise<IncomeStatement> {
    const params = new URLSearchParams({ branchId, fromDate, toDate });
    const value = await requestJson(`/api/reports/income?${params.toString()}`);
    if (!isRecord(value)) throw invalidResponse("The service returned an invalid income statement.");
    return value as unknown as IncomeStatement;
  },
  async balanceSheet(branchId: string, reportDate: string): Promise<BalanceSheet> {
    const params = new URLSearchParams({ branchId, reportDate });
    const value = await requestJson(`/api/reports/balance-sheet?${params.toString()}`);
    if (!isRecord(value)) throw invalidResponse("The service returned an invalid balance sheet.");
    return value as unknown as BalanceSheet;
  },
};
