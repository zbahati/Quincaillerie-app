import { authenticatedPosContext } from "@/app/api/pos/_shared";
import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { posListQuerySchema } from "@/lib/server/schemas/pos";
import { listBusinessPosProducts } from "@/lib/server/services/pos";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedPosContext(request);
    const parsed = posListQuerySchema.safeParse({
      branchId: request.nextUrl.searchParams.get("branchId") ?? undefined,
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      throw new AuthServiceError(400, "invalid_input", "The POS product query is invalid.");
    }
    const page = await listBusinessPosProducts(context, parsed.data);
    return jsonResponse({
      items: page.items.map((item) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        base_unit_name: item.baseUnitName,
        selling_price: item.sellingPrice,
        quantity_on_hand: item.quantityOnHand,
        base_unit_allows_decimals: item.baseUnitAllowsDecimals,
      })),
      total_count: page.totalCount,
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
