import {
  authenticatedContext,
  handleAuthRouteError,
  parseProductId,
  stockMovementDto,
} from "../../_shared";
import { jsonResponse } from "@/lib/server/auth/http";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { stockMovementListQuerySchema } from "@/lib/server/schemas/inventory";
import { listBusinessStockMovements } from "@/lib/server/services/inventory";
import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ productId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const context = await authenticatedContext(request);
    const { productId: rawProductId } = await params;
    const productId = parseProductId(rawProductId);
    const parsedQuery = stockMovementListQuerySchema.safeParse({
      branchId: request.nextUrl.searchParams.get("branchId") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success) {
      throw new AuthServiceError(
        400,
        "invalid_input",
        parsedQuery.error.issues[0]?.message ?? "The stock movement query is invalid.",
      );
    }
    const movements = await listBusinessStockMovements(context, productId, parsedQuery.data);
    return jsonResponse({ movements: movements.map(stockMovementDto) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
