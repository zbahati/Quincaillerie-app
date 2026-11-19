import { authenticatedDebtContext } from "@/app/api/customer-debt/_shared";
import { handleAuthRouteError, jsonResponse, readJsonBody, requireSameOrigin } from "@/lib/server/auth/http";
import { customerDebtPaymentSchema, customerDebtIdSchema } from "@/lib/server/schemas/customer-debt";
import { recordBusinessCustomerDebtPayment } from "@/lib/server/services/customer-debt";
import { AuthServiceError } from "@/lib/server/auth/errors";
import type { NextRequest } from "next/server";

interface RouteContext { params: Promise<{ debtId: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    requireSameOrigin(request);
    const context = await authenticatedDebtContext(request);
    const input = await readJsonBody(request, customerDebtPaymentSchema);
    const { debtId } = await params;
    const parsed = customerDebtIdSchema.safeParse(debtId);
    if (!parsed.success) {
      throw new AuthServiceError(400, "invalid_customer_debt_id", "The customer debt ID is invalid.");
    }
    const payment = await recordBusinessCustomerDebtPayment(context, parsed.data, input);
    return jsonResponse({
      payment: {
        id: payment.paymentId,
        customer_name: payment.customerName,
        payment_method: input.paymentMethod,
        amount: input.amount,
        balance_due: payment.balanceDue,
      },
    }, 201);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
