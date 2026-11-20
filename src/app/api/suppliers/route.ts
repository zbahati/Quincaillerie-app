import {
  authenticatedRelationshipContext,
  parseRelationshipBranchId,
  supplierDto,
} from "@/app/api/relationships-shared";
import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { supplierCreateSchema } from "@/lib/server/schemas/relationships";
import {
  createBusinessSupplier,
  listBusinessSuppliers,
} from "@/lib/server/services/relationships";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedRelationshipContext(request);
    const branchId = parseRelationshipBranchId(request.nextUrl.searchParams.get("branchId"));
    const suppliers = await listBusinessSuppliers(context, branchId);
    return jsonResponse({ suppliers: suppliers.map(supplierDto) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedRelationshipContext(request);
    const input = await readJsonBody(request, supplierCreateSchema);
    const supplier = await createBusinessSupplier(context, input);
    return jsonResponse({ supplier: supplierDto(supplier) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
