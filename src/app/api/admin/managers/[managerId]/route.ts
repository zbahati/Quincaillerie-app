import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { requireAdministrator } from "@/lib/server/auth/administrator";
import {
  managerPasswordResetSchema,
  managerUpdateSchema,
} from "@/lib/server/schemas/identity";
import {
  resetBusinessManagerPassword,
  updateBusinessManager,
} from "@/lib/server/services/business-administration";
import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ managerId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const context = await requireAdministrator(request);
    const { managerId } = await params;
    const input = await readJsonBody(request, managerUpdateSchema);
    return jsonResponse({
      manager: await updateBusinessManager(context, managerId, input),
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const context = await requireAdministrator(request);
    const { managerId } = await params;
    const input = await readJsonBody(request, managerPasswordResetSchema);
    await resetBusinessManagerPassword(context, managerId, input);
    return jsonResponse({ success: true });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
