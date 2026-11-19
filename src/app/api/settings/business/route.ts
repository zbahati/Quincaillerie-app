import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requestSessionToken,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { businessSettingsUpdateSchema } from "@/lib/server/schemas/business-settings";
import {
  getBusinessSettings,
  updateBusinessSettings,
} from "@/lib/server/services/business-settings";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await findAuthenticatedContext(requestSessionToken(request));
    if (!context) {
      throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
    }
    return jsonResponse({
      business: await getBusinessSettings(context),
      canManage: context.permissions.includes("business.manage"),
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const context = await findAuthenticatedContext(requestSessionToken(request));
    if (!context) {
      throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
    }
    const input = await readJsonBody(request, businessSettingsUpdateSchema);
    return jsonResponse({ business: await updateBusinessSettings(context, input) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
