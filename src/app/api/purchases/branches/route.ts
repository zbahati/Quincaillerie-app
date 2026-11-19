import { authenticatedPurchaseContext } from "@/app/api/purchases/_shared";
import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { listBusinessPurchaseBranches } from "@/lib/server/services/purchases";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedPurchaseContext(request);
    const branches = await listBusinessPurchaseBranches(context);
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
