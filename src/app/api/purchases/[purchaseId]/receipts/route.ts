import {
  authenticatedPurchaseContext,
  parsePurchaseId,
  purchaseReceiptDto,
} from "@/app/api/purchases/_shared";
import { handleAuthRouteError, jsonResponse, readJsonBody, requireSameOrigin } from "@/lib/server/auth/http";
import { purchaseReceiptSchema } from "@/lib/server/schemas/purchases";
import { receiveBusinessPurchase } from "@/lib/server/services/purchases";
import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ purchaseId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedPurchaseContext(request);
    const input = await readJsonBody(request, purchaseReceiptSchema);
    const { purchaseId } = await params;
    const receipt = await receiveBusinessPurchase(context, parsePurchaseId(purchaseId), input);
    return jsonResponse({ receipt: purchaseReceiptDto(receipt) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
