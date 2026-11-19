import {
  authenticatedRelationshipContext,
  customerDto,
  parseCustomerId,
} from "@/app/api/relationships-shared";
import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { customerUpdateSchema } from "@/lib/server/schemas/relationships";
import { updateBusinessCustomer } from "@/lib/server/services/relationships";
import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ customerId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedRelationshipContext(request);
    const { customerId } = await params;
    const input = await readJsonBody(request, customerUpdateSchema);
    const customer = await updateBusinessCustomer(
      context,
      parseCustomerId(customerId),
      input,
    );
    return jsonResponse({ customer: customerDto(customer) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
