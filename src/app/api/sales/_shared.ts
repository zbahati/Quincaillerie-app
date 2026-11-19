import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { requestSessionToken } from "@/lib/server/auth/http";
import type { SaleHistoryEntryRecord } from "@/lib/server/repositories/sales";
import type { NextRequest } from "next/server";

export async function authenticatedSalesContext(request: NextRequest) {
  const context = await findAuthenticatedContext(requestSessionToken(request));
  if (!context) {
    throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
  }
  return context;
}

export function saleHistoryEntryDto(sale: SaleHistoryEntryRecord) {
  return {
    id: sale.id,
    transaction_number: sale.transactionNumber,
    status: sale.status,
    customer_name: sale.customerName,
    sold_by: sale.soldBy,
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    amount_paid: sale.amountPaid,
    balance_due: sale.balanceDue,
    item_quantity: sale.itemQuantity,
    created_at: sale.createdAt.toISOString(),
    items: sale.items.map((item) => ({
      product_name: item.productName,
      sku: item.sku,
      quantity: item.quantity,
      unit_name: item.unitName,
      unit_price: item.unitPrice,
      line_total: item.lineTotal,
    })),
    payments: sale.payments.map((payment) => ({
      payment_method: payment.paymentMethod,
      amount: payment.amount,
    })),
  };
}
