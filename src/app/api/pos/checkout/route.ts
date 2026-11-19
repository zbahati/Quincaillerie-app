import { authenticatedPosContext, posReceiptDto } from "@/app/api/pos/_shared";
import { handleAuthRouteError, jsonResponse, readJsonBody, requireSameOrigin } from "@/lib/server/auth/http";
import { posCheckoutSchema } from "@/lib/server/schemas/pos";
import { checkoutBusinessPosSale } from "@/lib/server/services/pos";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedPosContext(request);
    const input = await readJsonBody(request, posCheckoutSchema);
    const receipt = await checkoutBusinessPosSale(context, input);
    return jsonResponse({ receipt: posReceiptDto(receipt) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
