import { authenticatedPosContext } from "@/app/api/pos/_shared";
import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { posPaymentOptionsQuerySchema } from "@/lib/server/schemas/pos";
import { listBusinessPosPaymentAccounts } from "@/lib/server/services/pos";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedPosContext(request);
    const parsed = posPaymentOptionsQuerySchema.safeParse({
      branchId: request.nextUrl.searchParams.get("branchId") ?? undefined,
    });
    if (!parsed.success) {
      throw new AuthServiceError(400, "invalid_input", "The POS payment-account query is invalid.");
    }
    const accounts = await listBusinessPosPaymentAccounts(context, parsed.data);
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
