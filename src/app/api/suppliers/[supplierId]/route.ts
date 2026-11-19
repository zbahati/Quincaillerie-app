import {
  authenticatedRelationshipContext,
  parseSupplierId,
  supplierDto,
} from "@/app/api/relationships-shared";
import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { supplierUpdateSchema } from "@/lib/server/schemas/relationships";
import { updateBusinessSupplier } from "@/lib/server/services/relationships";
import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ supplierId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedRelationshipContext(request);
    const { supplierId } = await params;
    const input = await readJsonBody(request, supplierUpdateSchema);
    const supplier = await updateBusinessSupplier(
      context,
      parseSupplierId(supplierId),
      input,
    );
    return jsonResponse({ supplier: supplierDto(supplier) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
