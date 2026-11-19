import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { requireAdministrator } from "@/lib/server/auth/administrator";
import { branchUpdateSchema } from "@/lib/server/schemas/identity";
import { updateBusinessBranch } from "@/lib/server/services/business-administration";
import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ branchId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const context = await requireAdministrator(request);
    const { branchId } = await params;
    const input = await readJsonBody(request, branchUpdateSchema);
    return jsonResponse({
      branch: await updateBusinessBranch(context, branchId, input),
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
