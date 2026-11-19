import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requestSessionToken,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { categoryCreateSchema } from "@/lib/server/schemas/catalog";
import {
  createBusinessCategory,
  listBusinessCategories,
} from "@/lib/server/services/catalog";
import type { NextRequest } from "next/server";

function categoryDto(category: Awaited<ReturnType<typeof listBusinessCategories>>[number]) {
  return {
    id: category.id,
    business_id: category.businessId,
    parent_id: category.parentId,
    name: category.name,
    description: category.description,
    is_active: category.isActive,
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
    const categories = await listBusinessCategories(context);
    return jsonResponse({ categories: categories.map(categoryDto) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedContext(request);
    const input = await readJsonBody(request, categoryCreateSchema);
    const category = await createBusinessCategory(context, input);
    return jsonResponse({ category: categoryDto(category) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
