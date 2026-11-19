import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { handleAuthRouteError, jsonResponse, requestSessionToken } from "@/lib/server/auth/http";
import { balanceSheetQuerySchema } from "@/lib/server/schemas/reports";
import { getBusinessBalanceSheet } from "@/lib/server/services/reports";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await findAuthenticatedContext(requestSessionToken(request));
    if (!context) throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
    const parsed = balanceSheetQuerySchema.safeParse({
      branchId: request.nextUrl.searchParams.get("branchId"),
      reportDate: request.nextUrl.searchParams.get("reportDate"),
    });
    if (!parsed.success) throw new AuthServiceError(400, "invalid_input", "The balance-sheet query is invalid.");
    const report = await getBusinessBalanceSheet(context, parsed.data);
    return jsonResponse({
      business_name: report.businessName,
      branch_name: report.branchName,
      report_date: report.reportDate,
      cash_accounts: report.cashAccounts,
      cash_and_bank: report.cashAndBank,
      inventory: report.inventory,
      accounts_receivable: report.accountsReceivable,
      total_assets: report.totalAssets,
      accounts_payable: report.accountsPayable,
      total_liabilities: report.totalLiabilities,
      retained_earnings: report.retainedEarnings,
      owner_equity: report.ownerEquity,
      total_equity: report.totalEquity,
      total_liabilities_and_equity: report.totalLiabilitiesAndEquity,
      balance_difference: report.balanceDifference,
      is_arithmetically_balanced: report.isArithmeticallyBalanced,
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
