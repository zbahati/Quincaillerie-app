import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requestSessionToken,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import {
  productIdSchema,
  productSellingPriceUpdateSchema,
} from "@/lib/server/schemas/products";
import { updateBusinessProductSellingPrice } from "@/lib/server/services/products";
import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ productId: string }>;
}

function parseProductId(value: string): string {
  const parsed = productIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AuthServiceError(400, "invalid_product_id", "The product ID is invalid.");
  }
  return parsed.data;
}

function productDto(product: Awaited<ReturnType<typeof updateBusinessProductSellingPrice>>) {
  return {
    id: product.id,
    business_id: product.businessId,
    category_id: product.categoryId,
    category_name: product.categoryName,
    brand_id: product.brandId,
    brand_name: product.brandName,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    description: product.description,
    size_dimensions: product.sizeDimensions,
    colour: product.colour,
    base_unit_id: product.baseUnitId,
    base_unit_name: product.baseUnitName,
    base_unit_code: product.baseUnitCode,
    purchase_price: product.purchasePrice,
    selling_price: product.sellingPrice,
    min_stock_quantity: product.minStockQuantity,
    vat_class: product.vatClass,
    is_active: product.isActive,
  };
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const context = await findAuthenticatedContext(requestSessionToken(request));
    if (!context) {
      throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
    }
    const { productId } = await params;
    const input = await readJsonBody(request, productSellingPriceUpdateSchema);
    const product = await updateBusinessProductSellingPrice(
      context,
      parseProductId(productId),
      input,
    );
    return jsonResponse({ product: productDto(product) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
