import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { requireAdministrator } from "@/lib/server/auth/administrator";
import { businessDetailsSchema } from "@/lib/server/schemas/identity";
import {
  getBusinessAdministration,
  updateBusinessAdministration,
} from "@/lib/server/services/business-administration";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  request.headers.get("cookie");
  try {
    const context = await requireAdministrator(request);
    return jsonResponse({ business: await getBusinessAdministration(context) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const context = await requireAdministrator(request);
    const input = await readJsonBody(request, businessDetailsSchema);
    return jsonResponse({
      business: await updateBusinessAdministration(context, input),
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
