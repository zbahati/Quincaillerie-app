import { authenticatedSalesContext } from "@/app/api/sales/_shared";
import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { listBusinessSalesBranches } from "@/lib/server/services/sales";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedSalesContext(request);
    const branches = await listBusinessSalesBranches(context);
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
