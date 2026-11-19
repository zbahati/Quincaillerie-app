import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface DailyReport {
  business_name: string;
  branch_name: string;
  report_date: string;
  from_date: string;
  to_date: string;
  sale_count: number;
  sales_total: number;
  collected_at_sale: number;
  credit_sales: number;
  customer_repayments: number;
  expenses_total: number;
  expenses_by_category: Array<{ category: string; amount: number }>;
  purchases_received: number;
  supplier_payments: number;
  opening_physical_cash: number;
  cash_inflow: number;
  cash_outflow: number;
  calculated_physical_cash: number;
  opening_customer_outstanding: number;
  closing_customer_outstanding: number;
  gross_profit: number;
  stock_adjustment_count: number;
}

export const reportsApi = {
  async daily(branchId: string, fromDate: string, toDate: string): Promise<DailyReport> {
    const params = new URLSearchParams({ branchId, fromDate, toDate });
    const value = await requestJson(`/api/reports/daily?${params.toString()}`);
    if (!isRecord(value)) {
      throw invalidResponse("The service returned an invalid daily report.");
    }
    return value as unknown as DailyReport;
  },
};
