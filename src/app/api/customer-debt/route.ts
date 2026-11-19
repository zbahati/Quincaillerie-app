import { authenticatedDebtContext } from "@/app/api/customer-debt/_shared";
import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { listBusinessCustomerDebts } from "@/lib/server/services/customer-debt";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedDebtContext(request);
    const debts = await listBusinessCustomerDebts(context);
    return jsonResponse({
      debts: debts.map((debt) => ({
        id: debt.id,
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
