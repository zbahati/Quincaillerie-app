import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requestSessionToken,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { brandCreateSchema } from "@/lib/server/schemas/catalog";
import {
  createBusinessBrand,
  listBusinessBrands,
} from "@/lib/server/services/catalog";
import type { NextRequest } from "next/server";

function brandDto(brand: Awaited<ReturnType<typeof listBusinessBrands>>[number]) {
  return {
    id: brand.id,
    business_id: brand.businessId,
    name: brand.name,
    is_active: brand.isActive,
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
    const brands = await listBusinessBrands(context);
    return jsonResponse({ brands: brands.map(brandDto) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedContext(request);
    const input = await readJsonBody(request, brandCreateSchema);
    const brand = await createBusinessBrand(context, input);
    return jsonResponse({ brand: brandDto(brand) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
