import { authenticatedPurchaseContext, purchaseDto } from "@/app/api/purchases/_shared";
import { handleAuthRouteError, jsonResponse, readJsonBody, requireSameOrigin } from "@/lib/server/auth/http";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { purchaseCreateSchema, purchaseListQuerySchema } from "@/lib/server/schemas/purchases";
import { createBusinessPurchase, listBusinessPurchases } from "@/lib/server/services/purchases";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedPurchaseContext(request);
    const parsed = purchaseListQuerySchema.safeParse({
      branchId: request.nextUrl.searchParams.get("branchId") ?? undefined,
    });
    if (!parsed.success) {
      throw new AuthServiceError(400, "invalid_input", "The purchase query is invalid.");
    }
    if (!parsed.data.branchId) {
      throw new AuthServiceError(400, "branch_required", "Select a branch to view purchases.");
    }
    const purchases = await listBusinessPurchases(context, parsed.data.branchId);
    return jsonResponse({ purchases: purchases.map(purchaseDto) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedPurchaseContext(request);
    const input = await readJsonBody(request, purchaseCreateSchema);
    const purchase = await createBusinessPurchase(context, input);
    return jsonResponse({ purchase: purchaseDto(purchase) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
