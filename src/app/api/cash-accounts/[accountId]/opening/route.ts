import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { handleAuthRouteError, jsonResponse, readJsonBody, requestSessionToken, requireSameOrigin } from "@/lib/server/auth/http";
import { cashAccountOpeningSchema } from "@/lib/server/schemas/ledger";
import { openBusinessCashAccount } from "@/lib/server/services/ledger";
import type { NextRequest } from "next/server";

interface RouteContext { params: Promise<{ accountId: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const auth = await findAuthenticatedContext(requestSessionToken(request));
    if (!auth) throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
    const input = await readJsonBody(request, cashAccountOpeningSchema);
    const { accountId } = await params;
    const account = await openBusinessCashAccount(auth, accountId, input);
    return jsonResponse({ account: { id: account.id, available_balance: account.availableBalance } }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
