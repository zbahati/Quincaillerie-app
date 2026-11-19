import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { handleAuthRouteError, jsonResponse, readJsonBody, requestSessionToken, requireSameOrigin } from "@/lib/server/auth/http";
import { cashTransferCreateSchema } from "@/lib/server/schemas/ledger";
import { createBusinessCashTransfer, listBusinessCashTransfers } from "@/lib/server/services/ledger";
import type { NextRequest } from "next/server";

async function context(request: NextRequest) {
  const value = await findAuthenticatedContext(requestSessionToken(request));
  if (!value) throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
  return value;
}

function dto(transfer: Awaited<ReturnType<typeof listBusinessCashTransfers>>[number]) {
  return {
    id: transfer.id,
    from_account_id: transfer.fromAccountId,
    to_account_id: transfer.toAccountId,
    amount: transfer.amount,
    status: transfer.status,
    occurred_at: transfer.occurredAt.toISOString(),
    initiated_by_user_id: transfer.initiatedByUserId,
    confirmed_by_user_id: transfer.confirmedByUserId,
    confirmed_at: transfer.confirmedAt?.toISOString() ?? null,
    cancelled_by_user_id: transfer.cancelledByUserId,
    cancelled_at: transfer.cancelledAt?.toISOString() ?? null,
    confirmation_reference: transfer.confirmationReference,
    created_at: transfer.createdAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const transfers = await listBusinessCashTransfers(await context(request));
    return jsonResponse({ transfers: transfers.map(dto) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const input = await readJsonBody(request, cashTransferCreateSchema);
    const transfer = await createBusinessCashTransfer(await context(request), input);
    return jsonResponse({ transfer: dto(transfer) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
