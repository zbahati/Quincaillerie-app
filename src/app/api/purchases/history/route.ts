import {
  authenticatedPurchaseContext,
  purchaseHistoryDto,
} from "@/app/api/purchases/_shared";
import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { purchaseHistoryQuerySchema } from "@/lib/server/schemas/purchases";
import { listBusinessPurchaseHistory } from "@/lib/server/services/purchases";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedPurchaseContext(request);
    const params = request.nextUrl.searchParams;
    const parsed = purchaseHistoryQuerySchema.safeParse({
      branchId: params.get("branchId"),
      search: params.get("search") ?? undefined,
      fromDate: params.get("fromDate") ?? undefined,
      toDate: params.get("toDate") ?? undefined,
      offset: params.get("offset") ?? 0,
      limit: params.get("limit") ?? 30,
    });
    if (!parsed.success) {
      throw new AuthServiceError(400, "invalid_input", "The purchase history query is invalid.");
    }
    const history = await listBusinessPurchaseHistory(context, parsed.data);
    return jsonResponse(purchaseHistoryDto(history));
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
