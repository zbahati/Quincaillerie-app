import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { handleAuthRouteError, jsonResponse, requestSessionToken } from "@/lib/server/auth/http";
import { dashboardQuerySchema } from "@/lib/server/schemas/dashboard";
import { getBusinessDashboard } from "@/lib/server/services/dashboard";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await findAuthenticatedContext(requestSessionToken(request));
    if (!context) {
      throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
    }
    const parsed = dashboardQuerySchema.safeParse({
      branchId: request.nextUrl.searchParams.get("branchId") ?? undefined,
    });
    if (!parsed.success) {
      throw new AuthServiceError(400, "invalid_input", "The dashboard query is invalid.");
    }
    const dashboard = await getBusinessDashboard(context, parsed.data);
    return jsonResponse({
      business: dashboard.business,
      branch: dashboard.branch,
      branches: dashboard.branches,
      inventory: {
        items: dashboard.inventory.items.map((item) => ({
          product_id: item.productId,
          name: item.name,
          sku: item.sku,
          base_unit_name: item.baseUnitName,
          quantity_on_hand: item.quantityOnHand,
          stock_value: item.stockValue,
          purchase_price: item.purchasePrice,
          selling_price: item.sellingPrice,
          minimum_selling_price: item.minimumSellingPrice,
          min_stock_quantity: item.minStockQuantity,
          base_unit_allows_decimals: item.baseUnitAllowsDecimals,
          has_movements: item.hasMovements,
        })),
        total_count: dashboard.inventory.totalCount,
        total_stock_value: dashboard.inventory.totalStockValue,
        low_stock_count: dashboard.inventory.lowStockCount,
        out_of_stock_count: dashboard.inventory.outOfStockCount,
      },
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
