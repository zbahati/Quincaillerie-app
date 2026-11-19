import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import type { ReportRangeQuery } from "@/lib/server/schemas/reports";

import { requirePermission } from "../auth/authorization";
import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { findBranchForBusiness } from "../repositories/branches";
import {
  calculateBalanceSheet,
  calculateDailyReport,
  calculateIncomeStatement,
} from "../repositories/reports";

export async function getBusinessDailyReport(
  context: AuthenticatedContext,
  query: ReportRangeQuery,
) {
  requirePermission(context, "reports.read");
  const branchId = query.branchId;
  if (context.role === "manager") {
    if (!context.branchId || branchId !== context.branchId) {
      throw new AuthServiceError(403, "forbidden", "You cannot access this branch.");
    }
  }
  const pool = getDatabasePool();
  const branch = await findBranchForBusiness(pool, context.businessId, branchId);
  if (!branch || !branch.isActive) {
    throw new AuthServiceError(404, "branch_not_found", "The selected branch is unavailable.");
  }
  return calculateDailyReport(
    pool,
    context.businessId,
    branch.id,
    query.fromDate,
    query.toDate,
  );
}

export async function getBusinessIncomeStatement(
  context: AuthenticatedContext,
  query: ReportRangeQuery,
) {
  requirePermission(context, "reports.read");
  const branchId = query.branchId;
  if (context.role === "manager") {
    if (!context.branchId || branchId !== context.branchId) {
      throw new AuthServiceError(403, "forbidden", "You cannot access this branch.");
    }
  }
  const pool = getDatabasePool();
  const branch = await findBranchForBusiness(pool, context.businessId, branchId);
  if (!branch || !branch.isActive) {
    throw new AuthServiceError(404, "branch_not_found", "The selected branch is unavailable.");
  }
  return calculateIncomeStatement(
    pool,
    context.businessId,
    branch.id,
    query.fromDate,
    query.toDate,
  );
}

export async function getBusinessBalanceSheet(
  context: AuthenticatedContext,
  query: { branchId: string; reportDate: string },
) {
  requirePermission(context, "reports.read");
  const branchId = query.branchId;
  if (context.role === "manager") {
    if (!context.branchId || branchId !== context.branchId) {
      throw new AuthServiceError(403, "forbidden", "You cannot access this branch.");
    }
  }
  const pool = getDatabasePool();
  const branch = await findBranchForBusiness(pool, context.businessId, branchId);
  if (!branch || !branch.isActive) {
    throw new AuthServiceError(404, "branch_not_found", "The selected branch is unavailable.");
  }
  return calculateBalanceSheet(pool, context.businessId, branch.id, query.reportDate);
}
