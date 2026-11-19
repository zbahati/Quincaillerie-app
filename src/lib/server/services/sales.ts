import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import type { SalesHistoryQuery } from "@/lib/server/schemas/sales";

import { requireBusinessScope, requirePermission } from "../auth/authorization";
import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { findBranchForBusiness, listBranchesForBusiness } from "../repositories/branches";
import { listSalesHistory } from "../repositories/sales";

async function resolveBranch(context: AuthenticatedContext, branchId: string) {
  if (context.role === "manager") {
    if (!context.branchId || branchId !== context.branchId) {
      throw new AuthServiceError(403, "forbidden", "You cannot access this branch.");
    }
  }
  const branch = await findBranchForBusiness(getDatabasePool(), context.businessId, branchId);
  if (!branch || !branch.isActive) {
    throw new AuthServiceError(404, "branch_not_found", "The selected branch is unavailable.");
  }
  requireBusinessScope(context, context.businessId, branch.id);
  return branch;
}

export async function listBusinessSalesBranches(context: AuthenticatedContext) {
  requirePermission(context, "sales.read");
  if (context.role === "admin") {
    return listBranchesForBusiness(getDatabasePool(), context.businessId);
  }
  if (!context.branchId) {
    throw new AuthServiceError(403, "forbidden", "A branch assignment is required.");
  }
  const branch = await findBranchForBusiness(getDatabasePool(), context.businessId, context.branchId);
  if (!branch || !branch.isActive) {
    throw new AuthServiceError(403, "forbidden", "Your assigned branch is unavailable.");
  }
  return [branch];
}

export async function listBusinessSalesHistory(
  context: AuthenticatedContext,
  query: SalesHistoryQuery,
) {
  requirePermission(context, "sales.read");
  const branch = await resolveBranch(context, query.branchId);
  return listSalesHistory(getDatabasePool(), context.businessId, branch.id, query);
}
