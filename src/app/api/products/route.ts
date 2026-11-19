import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requestSessionToken,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { productCreateSchema, productListQuerySchema } from "@/lib/server/schemas/products";
import {
  createBusinessProduct,
  listBusinessProducts,
} from "@/lib/server/services/products";
import type { NextRequest } from "next/server";

function productDto(product: Awaited<ReturnType<typeof listBusinessProducts>>["items"][number]) {
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

async function authenticatedContext(request: NextRequest) {
  const context = await findAuthenticatedContext(requestSessionToken(request));
  if (!context) {
    throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
  }
  return context;
}

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedContext(request);
    const parsedQuery = productListQuerySchema.safeParse({
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success) {
      throw new AuthServiceError(
        400,
        "invalid_input",
        parsedQuery.error.issues[0]?.message ?? "The product query is invalid.",
      );
    }
    const page = await listBusinessProducts(context, parsedQuery.data);
    return jsonResponse({
      items: page.items.map(productDto),
      total_count: page.totalCount,
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedContext(request);
    const input = await readJsonBody(request, productCreateSchema);
    const product = await createBusinessProduct(context, input);
    return jsonResponse({ product: productDto(product) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
