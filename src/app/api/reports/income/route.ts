import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { handleAuthRouteError, jsonResponse, requestSessionToken } from "@/lib/server/auth/http";
import { reportRangeQuerySchema } from "@/lib/server/schemas/reports";
import { getBusinessIncomeStatement } from "@/lib/server/services/reports";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await findAuthenticatedContext(requestSessionToken(request));
    if (!context) throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
    const parsed = reportRangeQuerySchema.safeParse({
      branchId: request.nextUrl.searchParams.get("branchId"),
      fromDate: request.nextUrl.searchParams.get("fromDate"),
      toDate: request.nextUrl.searchParams.get("toDate"),
    });
    if (!parsed.success) throw new AuthServiceError(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid report range.");
    const report = await getBusinessIncomeStatement(context, parsed.data);
    return jsonResponse({
      business_name: report.businessName,
      branch_name: report.branchName,
      from_date: report.fromDate,
      to_date: report.toDate,
      sale_count: report.saleCount,
      sales_total: report.salesTotal,
      cost_of_goods_sold: report.costOfGoodsSold,
      gross_profit: report.grossProfit,
      expenses_total: report.expensesTotal,
      operating_result: report.operatingResult,
      expenses_by_category: report.expensesByCategory,
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
