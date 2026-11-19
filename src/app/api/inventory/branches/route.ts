import {
  authenticatedContext,
  handleAuthRouteError,
  inventoryBranchDto,
} from "../_shared";
import { jsonResponse } from "@/lib/server/auth/http";
import { listBusinessInventoryBranches } from "@/lib/server/services/inventory";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedContext(request);
    const branches = await listBusinessInventoryBranches(context);
    return jsonResponse({ branches: branches.map(inventoryBranchDto) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
