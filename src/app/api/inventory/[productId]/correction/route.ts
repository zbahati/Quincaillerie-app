import {
  authenticatedContext,
  handleAuthRouteError,
  parseProductId,
  stockMovementDto,
} from "../../_shared";
import {
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { stockCorrectionSchema } from "@/lib/server/schemas/inventory";
import { correctBusinessStock } from "@/lib/server/services/inventory";
import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ productId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedContext(request);
    const { productId: rawProductId } = await params;
    const productId = parseProductId(rawProductId);
    const input = await readJsonBody(request, stockCorrectionSchema);
    const movement = await correctBusinessStock(context, productId, input);
    return jsonResponse({ movement: stockMovementDto(movement) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
