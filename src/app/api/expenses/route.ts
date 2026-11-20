import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { handleAuthRouteError, jsonResponse, readJsonBody, requestSessionToken, requireSameOrigin } from "@/lib/server/auth/http";
import { expenseCreateSchema } from "@/lib/server/schemas/ledger";
import { createBusinessExpense, listBusinessExpenses } from "@/lib/server/services/ledger";
import type { NextRequest } from "next/server";

async function context(request: NextRequest) {
  const value = await findAuthenticatedContext(requestSessionToken(request));
  if (!value) throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const rawBranchId = request.nextUrl.searchParams.get("branchId");
    const branchId = rawBranchId === "unassigned" ? null : rawBranchId;
    if (branchId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(branchId)) {
      throw new AuthServiceError(400, "branch_required", "Select an active branch.");
    }
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0);
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
    const page = await listBusinessExpenses(await context(request), branchId, offset, limit);
    return jsonResponse({
      items: page.items.map((expense) => ({
        id: expense.id,
        business_id: expense.businessId,
        branch_id: expense.branchId,
        category: expense.category,
        amount: expense.amount,
        expense_date: expense.expenseDate,
        payment_method: expense.paymentMethod,
        cash_account_id: expense.cashAccountId,
        description: expense.description,
        responsible_name: expense.responsibleName,
        created_at: expense.createdAt.toISOString(),
      })),
      total_count: page.totalCount,
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const input = await readJsonBody(request, expenseCreateSchema);
    const expense = await createBusinessExpense(await context(request), input);
    return jsonResponse({ expense: {
      id: expense.id,
      category: expense.category,
      amount: expense.amount,
      expense_date: expense.expenseDate,
      payment_method: expense.paymentMethod,
      cash_account_id: expense.cashAccountId,
      description: expense.description,
      responsible_name: expense.responsibleName,
      created_at: expense.createdAt.toISOString(),
    } }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
