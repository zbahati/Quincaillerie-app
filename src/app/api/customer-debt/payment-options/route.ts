import { authenticatedDebtContext } from "@/app/api/customer-debt/_shared";
import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { customerDebtBranchIdSchema } from "@/lib/server/schemas/customer-debt";
import { listBusinessCustomerPaymentAccounts } from "@/lib/server/services/customer-debt";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedDebtContext(request);
    const parsedBranchId = customerDebtBranchIdSchema.safeParse(
      request.nextUrl.searchParams.get("branchId"),
    );
    if (!parsedBranchId.success) {
      throw new AuthServiceError(400, "invalid_branch_id", "The branch ID is invalid.");
    }
    const accounts = await listBusinessCustomerPaymentAccounts(context, parsedBranchId.data);
    return jsonResponse({
      accounts: accounts.map((account) => ({
        id: account.id,
        account_type: account.accountType,
        name: account.name,
      })),
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
