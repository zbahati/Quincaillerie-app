import { authenticatedPurchaseContext } from "@/app/api/purchases/_shared";
import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { purchaseListQuerySchema } from "@/lib/server/schemas/purchases";
import { listBusinessPurchasePaymentOptions } from "@/lib/server/services/purchases";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedPurchaseContext(request);
    const parsed = purchaseListQuerySchema.safeParse({
      branchId: request.nextUrl.searchParams.get("branchId") ?? undefined,
    });
    if (!parsed.success || !parsed.data.branchId) {
      throw new AuthServiceError(400, "invalid_input", "Select a valid branch for supplier payments.");
    }
    const options = await listBusinessPurchasePaymentOptions(context, parsed.data.branchId);
    return jsonResponse({
      accounts: options.map((account) => ({
        id: account.id,
        account_type: account.accountType,
        name: account.name,
        available_balance: account.availableBalance,
      })),
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
