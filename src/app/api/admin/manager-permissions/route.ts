import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { requireAdministrator } from "@/lib/server/auth/administrator";
import { managerPermissionUpdateSchema } from "@/lib/server/schemas/identity";
import {
  getBusinessManagerPermissions,
  updateBusinessManagerPermissions,
} from "@/lib/server/services/business-administration";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  request.headers.get("cookie");
  try {
    const context = await requireAdministrator(request);
    return jsonResponse({ permissions: await getBusinessManagerPermissions(context) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function PUT(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const context = await requireAdministrator(request);
    const grants = await readJsonBody(request, managerPermissionUpdateSchema);
    return jsonResponse({
      permissions: await updateBusinessManagerPermissions(context, grants),
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
