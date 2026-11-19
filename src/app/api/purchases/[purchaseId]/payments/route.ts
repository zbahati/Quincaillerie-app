import {
  authenticatedPurchaseContext,
  parsePurchaseId,
  purchaseDto,
} from "@/app/api/purchases/_shared";
import { handleAuthRouteError, jsonResponse, readJsonBody, requireSameOrigin } from "@/lib/server/auth/http";
import { purchasePaymentSchema } from "@/lib/server/schemas/purchases";
import { recordBusinessPurchasePayment } from "@/lib/server/services/purchases";
import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ purchaseId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedPurchaseContext(request);
    const input = await readJsonBody(request, purchasePaymentSchema);
    const { purchaseId } = await params;
    const purchase = await recordBusinessPurchasePayment(
      context,
      parsePurchaseId(purchaseId),
      input,
    );
    return jsonResponse({ purchase: purchaseDto(purchase) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
