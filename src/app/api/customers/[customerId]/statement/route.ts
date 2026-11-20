import { authenticatedDebtContext } from "@/app/api/customer-debt/_shared";
import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { customerDebtBranchIdSchema, customerIdSchema } from "@/lib/server/schemas/customer-debt";
import { getBusinessCustomerStatement } from "@/lib/server/services/customer-debt";
import { AuthServiceError } from "@/lib/server/auth/errors";
import type { NextRequest } from "next/server";

interface RouteContext { params: Promise<{ customerId: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const context = await authenticatedDebtContext(request);
    const { customerId } = await params;
    const parsed = customerIdSchema.safeParse(customerId);
    if (!parsed.success) {
      throw new AuthServiceError(400, "invalid_customer_id", "The customer ID is invalid.");
    }
    const rawBranchId = request.nextUrl.searchParams.get("branchId");
    const parsedBranchId = rawBranchId === null
      ? undefined
      : customerDebtBranchIdSchema.safeParse(rawBranchId);
    if (parsedBranchId && !parsedBranchId.success) {
      throw new AuthServiceError(400, "invalid_branch_id", "The branch ID is invalid.");
    }
    const branchId = parsedBranchId?.success ? parsedBranchId.data : undefined;
    const statement = await getBusinessCustomerStatement(context, parsed.data, branchId);
    return jsonResponse({
      customer: {
        id: statement.customer.id,
        branch_id: statement.customer.branchId,
        name: statement.customer.name,
        phone: statement.customer.phone,
        address: statement.customer.address,
        customer_type: statement.customer.customerType,
        credit_limit: statement.customer.creditLimit,
      },
      total_sales: statement.totalSales,
      total_payments: statement.totalPayments,
      outstanding_balance: statement.outstandingBalance,
      entries: statement.entries.map((entry) => ({
        id: entry.id,
        transaction_number: entry.transactionNumber,
        entry_type: entry.entryType,
        payment_method: entry.paymentMethod,
        amount: entry.amount,
        balance_after: entry.balanceAfter,
        created_at: entry.createdAt.toISOString(),
      })),
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
