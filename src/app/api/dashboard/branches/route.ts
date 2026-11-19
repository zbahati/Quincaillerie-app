import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { handleAuthRouteError, jsonResponse, requestSessionToken } from "@/lib/server/auth/http";
import { listBusinessInventoryBranches } from "@/lib/server/services/inventory";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await findAuthenticatedContext(requestSessionToken(request));
    if (!context) {
      throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
    }
    const branches = await listBusinessInventoryBranches(context);
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
