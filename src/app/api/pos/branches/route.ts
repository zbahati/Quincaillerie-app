import { authenticatedPosContext } from "@/app/api/pos/_shared";
import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { listBusinessPosBranches } from "@/lib/server/services/pos";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedPosContext(request);
    const branches = await listBusinessPosBranches(context);
    return jsonResponse({
      branches: branches.map((branch) => ({
        id: branch.id,
        name: branch.name,
        is_active: branch.isActive,
      })),
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
