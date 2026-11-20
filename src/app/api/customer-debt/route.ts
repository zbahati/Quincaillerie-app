import { authenticatedDebtContext } from "@/app/api/customer-debt/_shared";
import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { listBusinessCustomerDebts } from "@/lib/server/services/customer-debt";
import { customerDebtBranchIdSchema } from "@/lib/server/schemas/customer-debt";
import { AuthServiceError } from "@/lib/server/auth/errors";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedDebtContext(request);
    const rawBranchId = request.nextUrl.searchParams.get("branchId");
    const parsedBranchId = rawBranchId === null
      ? undefined
      : customerDebtBranchIdSchema.safeParse(rawBranchId);
    if (parsedBranchId && !parsedBranchId.success) {
      throw new AuthServiceError(400, "invalid_branch_id", "The branch ID is invalid.");
    }
    const branchId = parsedBranchId?.success ? parsedBranchId.data : undefined;
    const debts = await listBusinessCustomerDebts(context, branchId);
    return jsonResponse({
      debts: debts.map((debt) => ({
        id: debt.id,
        branch_id: debt.branchId,
        customer_id: debt.customerId,
        customer_name: debt.customerName,
        sale_id: debt.saleId,
        transaction_number: debt.transactionNumber,
        original_amount: debt.originalAmount,
        amount_paid: debt.amountPaid,
        balance_due: debt.balanceDue,
        created_at: debt.createdAt.toISOString(),
      })),
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
