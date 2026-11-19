import {
  authenticatedRelationshipContext,
  customerDto,
} from "@/app/api/relationships-shared";
import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { customerCreateSchema } from "@/lib/server/schemas/relationships";
import {
  createBusinessCustomer,
  listBusinessCustomers,
} from "@/lib/server/services/relationships";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedRelationshipContext(request);
    const customers = await listBusinessCustomers(context);
    return jsonResponse({ customers: customers.map(customerDto) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedRelationshipContext(request);
    const input = await readJsonBody(request, customerCreateSchema);
    const customer = await createBusinessCustomer(context, input);
    return jsonResponse({ customer: customerDto(customer) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
