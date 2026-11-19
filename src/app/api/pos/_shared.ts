import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { requestSessionToken } from "@/lib/server/auth/http";
import type { SaleReceiptRecord } from "@/lib/server/repositories/pos";
import type { NextRequest } from "next/server";

export async function authenticatedPosContext(request: NextRequest) {
  const context = await findAuthenticatedContext(requestSessionToken(request));
  if (!context) {
    throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
  }
  return context;
}

export function posReceiptDto(receipt: SaleReceiptRecord) {
  return {
    id: receipt.id,
    transaction_number: receipt.transactionNumber,
    payment_method: receipt.paymentMethod,
    total: receipt.total,
    amount_paid: receipt.amountPaid,
    balance_due: receipt.balanceDue,
    customer_name: receipt.customerName,
    created_at: receipt.createdAt.toISOString(),
    items: receipt.items.map((item) => ({
      product_name: item.productName,
      sku: item.sku,
      quantity: item.quantity,
      unit_name: item.unitName,
      listed_unit_price: item.listedUnitPrice,
      unit_price: item.unitPrice,
      line_total: item.lineTotal,
      price_change_reason: item.priceChangeReason,
    })),
    payments: receipt.payments.map((payment) => ({
      payment_method: payment.paymentMethod,
      amount: payment.amount,
    })),
  };
}
