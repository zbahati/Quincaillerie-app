import { authenticatedSalesContext, saleHistoryEntryDto } from "@/app/api/sales/_shared";
import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { salesHistoryQuerySchema } from "@/lib/server/schemas/sales";
import { listBusinessSalesHistory } from "@/lib/server/services/sales";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedSalesContext(request);
    const parsed = salesHistoryQuerySchema.safeParse({
      branchId: request.nextUrl.searchParams.get("branchId") ?? undefined,
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      fromDate: request.nextUrl.searchParams.get("fromDate") ?? undefined,
      toDate: request.nextUrl.searchParams.get("toDate") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      throw new AuthServiceError(
        400,
        "invalid_input",
        parsed.error.issues[0]?.message ?? "The sales history query is invalid.",
      );
    }
    const page = await listBusinessSalesHistory(context, parsed.data);
    return jsonResponse({
      items: page.items.map(saleHistoryEntryDto),
      total_count: page.totalCount,
      completed_sales_total: page.completedSalesTotal,
      collected_at_sale_total: page.collectedAtSaleTotal,
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
