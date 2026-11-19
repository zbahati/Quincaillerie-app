import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { requireAdministrator } from "@/lib/server/auth/administrator";
import { managerCreateSchema } from "@/lib/server/schemas/identity";
import {
  createBusinessManager,
  listBusinessManagers,
} from "@/lib/server/services/business-administration";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  request.headers.get("cookie");
  try {
    const context = await requireAdministrator(request);
    return jsonResponse({ managers: await listBusinessManagers(context) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const context = await requireAdministrator(request);
    const input = await readJsonBody(request, managerCreateSchema);
    return jsonResponse({ manager: await createBusinessManager(context, input) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
