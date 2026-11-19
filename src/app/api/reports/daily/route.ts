import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { handleAuthRouteError, jsonResponse, requestSessionToken } from "@/lib/server/auth/http";
import { reportRangeQuerySchema } from "@/lib/server/schemas/reports";
import { getBusinessDailyReport } from "@/lib/server/services/reports";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await findAuthenticatedContext(requestSessionToken(request));
    if (!context) {
      throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
    }
    const parsed = reportRangeQuerySchema.safeParse({
      branchId: request.nextUrl.searchParams.get("branchId"),
      fromDate: request.nextUrl.searchParams.get("fromDate"),
      toDate: request.nextUrl.searchParams.get("toDate"),
    });
    if (!parsed.success) {
      throw new AuthServiceError(400, "invalid_input", parsed.error.issues[0]?.message ?? "The report query is invalid.");
    }
    const report = await getBusinessDailyReport(context, parsed.data);
    return jsonResponse({
      business_name: report.businessName,
      branch_name: report.branchName,
      report_date: `${report.fromDate} to ${report.toDate}`,
      from_date: report.fromDate,
      to_date: report.toDate,
      sale_count: report.saleCount,
      sales_total: report.salesTotal,
      collected_at_sale: report.collectedAtSale,
      credit_sales: report.creditSales,
      customer_repayments: report.customerRepayments,
      expenses_total: report.expensesTotal,
      expenses_by_category: report.expensesByCategory,
      purchases_received: report.purchasesReceived,
      supplier_payments: report.supplierPayments,
      opening_physical_cash: report.openingPhysicalCash,
      cash_inflow: report.cashInflow,
      cash_outflow: report.cashOutflow,
      calculated_physical_cash: report.calculatedPhysicalCash,
      opening_customer_outstanding: report.openingCustomerOutstanding,
      closing_customer_outstanding: report.closingCustomerOutstanding,
      gross_profit: report.grossProfit,
      stock_adjustment_count: report.stockAdjustmentCount,
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
