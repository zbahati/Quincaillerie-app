import { authenticatedPurchaseContext } from "@/app/api/purchases/_shared";
import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { listBusinessPurchaseProducts } from "@/lib/server/services/purchases";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedPurchaseContext(request);
    const products = await listBusinessPurchaseProducts(context);
    return jsonResponse({
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        base_unit_name: product.baseUnitName,
        purchase_price: product.purchasePrice,
        base_unit_allows_decimals: product.baseUnitAllowsDecimals,
      })),
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
