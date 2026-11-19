import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { handleAuthRouteError, jsonResponse, readJsonBody, requestSessionToken, requireSameOrigin } from "@/lib/server/auth/http";
import { cashAccountCreateSchema } from "@/lib/server/schemas/ledger";
import { createBusinessCashAccount, listBusinessCashAccounts } from "@/lib/server/services/ledger";
import type { NextRequest } from "next/server";

async function context(request: NextRequest) {
  const value = await findAuthenticatedContext(requestSessionToken(request));
  if (!value) throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const accounts = await listBusinessCashAccounts(await context(request));
    return jsonResponse({ accounts: accounts.map((account) => ({
      id: account.id,
      business_id: account.businessId,
      branch_id: account.branchId,
      account_type: account.accountType,
      name: account.name,
      responsible_user_id: account.responsibleUserId,
      responsible_name: account.responsibleName,
      is_active: account.isActive,
      opening_amount: account.openingAmount,
      available_balance: account.availableBalance,
      created_at: account.createdAt.toISOString(),
      updated_at: account.updatedAt.toISOString(),
    })) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const input = await readJsonBody(request, cashAccountCreateSchema);
    const account = await createBusinessCashAccount(await context(request), input);
    return jsonResponse({ account: {
      id: account.id,
      account_type: account.accountType,
      name: account.name,
      available_balance: account.availableBalance,
    } }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
