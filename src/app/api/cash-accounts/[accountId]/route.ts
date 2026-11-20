import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requestSessionToken,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { cashAccountUpdateSchema } from "@/lib/server/schemas/ledger";
import { updateBusinessCashAccount } from "@/lib/server/services/ledger";
import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ accountId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const context = await findAuthenticatedContext(requestSessionToken(request));
    if (!context) {
      throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
    }
    const input = await readJsonBody(request, cashAccountUpdateSchema);
    const { accountId } = await params;
    await updateBusinessCashAccount(context, accountId, input);
    return jsonResponse({ status: "updated" });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
