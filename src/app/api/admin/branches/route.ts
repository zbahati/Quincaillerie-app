import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { requireAdministrator } from "@/lib/server/auth/administrator";
import { branchDetailsSchema } from "@/lib/server/schemas/identity";
import {
  createBusinessBranch,
  listBusinessBranches,
} from "@/lib/server/services/business-administration";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  request.headers.get("cookie");
  try {
    const context = await requireAdministrator(request);
    return jsonResponse({ branches: await listBusinessBranches(context) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const context = await requireAdministrator(request);
    const input = await readJsonBody(request, branchDetailsSchema);
    return jsonResponse({ branch: await createBusinessBranch(context, input) }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
