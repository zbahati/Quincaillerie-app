import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requestSessionToken,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { productIdSchema, productUnitCreateSchema } from "@/lib/server/schemas/products";
import {
  createBusinessProductUnit,
  listBusinessProductUnits,
} from "@/lib/server/services/products";
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

function productUnitDto(unit: Awaited<ReturnType<typeof listBusinessProductUnits>>[number]) {
  return {
    id: unit.id,
    product_id: unit.productId,
    unit_id: unit.unitId,
    unit_name: unit.unitName,
    unit_code: unit.unitCode,
    conversion_factor: unit.conversionFactor,
    is_base: unit.isBase,
    selling_price: unit.sellingPrice,
  };
}

async function authenticatedContext(request: NextRequest) {
  const context = await findAuthenticatedContext(requestSessionToken(request));
  if (!context) {
    throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
  }
  return context;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const context = await authenticatedContext(request);
    const { productId } = await params;
    const units = await listBusinessProductUnits(context, parseProductId(productId));
    return jsonResponse({ units: units.map(productUnitDto) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedContext(request);
    const { productId } = await params;
    const input = await readJsonBody(request, productUnitCreateSchema);
    const unit = await createBusinessProductUnit(context, parseProductId(productId), input);
    return jsonResponse({ unit: productUnitDto(unit) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
