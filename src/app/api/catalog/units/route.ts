import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requestSessionToken,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { unitCreateSchema } from "@/lib/server/schemas/catalog";
import {
  createBusinessUnit,
  listBusinessUnits,
} from "@/lib/server/services/catalog";
import type { NextRequest } from "next/server";

function unitDto(unit: Awaited<ReturnType<typeof listBusinessUnits>>[number]) {
  return {
    id: unit.id,
    business_id: unit.businessId,
    code: unit.code,
    name: unit.name,
    decimals_ok: unit.decimalsOk,
    is_system: unit.isSystem,
    is_active: unit.isActive,
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
    const units = await listBusinessUnits(context);
    return jsonResponse({ units: units.map(unitDto) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedContext(request);
    const input = await readJsonBody(request, unitCreateSchema);
    const unit = await createBusinessUnit(context, input);
    return jsonResponse({ unit: unitDto(unit) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
