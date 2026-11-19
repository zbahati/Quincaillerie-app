import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { handleAuthRouteError, jsonResponse, readJsonBody, requestSessionToken, requireSameOrigin } from "@/lib/server/auth/http";
import { cashTransferConfirmSchema } from "@/lib/server/schemas/ledger";
import { confirmBusinessCashTransfer } from "@/lib/server/services/ledger";
import type { NextRequest } from "next/server";

interface RouteContext { params: Promise<{ transferId: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const auth = await findAuthenticatedContext(requestSessionToken(request));
    if (!auth) throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
    const input = await readJsonBody(request, cashTransferConfirmSchema);
    const { transferId } = await params;
    const transfer = await confirmBusinessCashTransfer(auth, transferId, input.confirmationReference ?? null);
    return jsonResponse({ transfer: {
      id: transfer.id,
      status: transfer.status,
      amount: transfer.amount,
      confirmation_reference: transfer.confirmationReference,
      confirmed_at: transfer.confirmedAt?.toISOString() ?? null,
    } });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
