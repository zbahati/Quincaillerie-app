import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import type { DashboardQuery } from "@/lib/server/schemas/dashboard";

import { requirePermission } from "../auth/authorization";
import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { findBusinessById } from "../repositories/businesses";
import { findBranchForBusiness, listBranchesForBusiness } from "../repositories/branches";
import { listInventory } from "../repositories/inventory";

export async function getBusinessDashboard(
  context: AuthenticatedContext,
  query: DashboardQuery,
) {
  requirePermission(context, "inventory.read");

  let branchId = query.branchId;
  if (context.role === "manager") {
    if (!context.branchId || (branchId && branchId !== context.branchId)) {
      throw new AuthServiceError(403, "forbidden", "You cannot access this branch.");
    }
    branchId = context.branchId;
  } else if (!branchId) {
    throw new AuthServiceError(400, "branch_required", "Select a branch to view the dashboard.");
  }

  const pool = getDatabasePool();
  const branch = await findBranchForBusiness(pool, context.businessId, branchId);
  if (!branch || !branch.isActive) {
    throw new AuthServiceError(404, "branch_not_found", "The selected branch is unavailable.");
  }
  const business = await findBusinessById(pool, context.businessId);
  if (!business?.isActive) {
    throw new AuthServiceError(404, "business_not_found", "The business is unavailable.");
  }

  const inventory = await listInventory(pool, context.businessId, branch.id, {
    branchId: branch.id,
    search: undefined,
    offset: 0,
    limit: 8,
  });
  const branches = context.role === "admin"
    ? await listBranchesForBusiness(pool, context.businessId)
    : [branch];

  return {
    business: { id: business.id, name: business.name },
    branch: { id: branch.id, name: branch.name, is_active: branch.isActive },
    branches: branches.map((item) => ({
      id: item.id,
      name: item.name,
      is_active: item.isActive,
    })),
    inventory,
  };
}
