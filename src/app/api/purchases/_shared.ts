import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { requestSessionToken } from "@/lib/server/auth/http";
import type { PurchaseRecord, PurchaseReceiptRecord } from "@/lib/server/repositories/purchases";
import { purchaseIdSchema } from "@/lib/server/schemas/purchases";
import type { NextRequest } from "next/server";

export async function authenticatedPurchaseContext(request: NextRequest) {
  const context = await findAuthenticatedContext(requestSessionToken(request));
  if (!context) {
    throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
  }
  return context;
}

export function parsePurchaseId(value: string): string {
  const parsed = purchaseIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AuthServiceError(400, "invalid_purchase_id", "The purchase ID is invalid.");
  }
  return parsed.data;
}

export function purchaseDto(purchase: PurchaseRecord) {
  return {
    id: purchase.id,
    supplier_id: purchase.supplierId,
    supplier_name: purchase.supplierName,
    supplier_invoice_number: purchase.supplierInvoiceNumber,
    status: purchase.status,
    subtotal: purchase.subtotal,
    amount_paid: purchase.amountPaid,
    balance_due: purchase.balanceDue,
    duplicate_authorized: purchase.duplicateAuthorized,
    duplicate_of_purchase_id: purchase.duplicateOfPurchaseId,
    created_at: purchase.createdAt.toISOString(),
    items: purchase.items.map((item) => ({
      id: item.id,
      product_id: item.productId,
      product_name: item.productName,
      sku: item.sku,
      unit_name: item.unitName,
      ordered_quantity: item.orderedQuantity,
      received_quantity: item.receivedQuantity,
      unit_cost: item.unitCost,
      line_total: item.lineTotal,
      base_unit_allows_decimals: item.baseUnitAllowsDecimals,
    })),
    deliveries: purchase.deliveries.map((delivery) => ({
      id: delivery.id,
      delivery_reference: delivery.deliveryReference,
      notes: delivery.notes,
      total_cost: delivery.totalCost,
      created_at: delivery.createdAt.toISOString(),
      items: delivery.items.map((item) => ({
        product_name: item.productName,
        quantity: item.quantity,
        unit_name: item.unitName,
        total_cost: item.totalCost,
      })),
    })),
    payments: purchase.payments.map((payment) => ({
      id: payment.id,
      payment_method: payment.paymentMethod,
      amount: payment.amount,
      created_at: payment.createdAt.toISOString(),
    })),
  };
}

export function purchaseHistoryDto(history: {
  items: PurchaseRecord[];
  totalCount: number;
  purchaseTotal: number;
  paidTotal: number;
  balanceDueTotal: number;
}) {
  return {
    items: history.items.map(purchaseDto),
    total_count: history.totalCount,
    purchase_total: history.purchaseTotal,
    paid_total: history.paidTotal,
    balance_due_total: history.balanceDueTotal,
  };
}

export function purchaseReceiptDto(receipt: PurchaseReceiptRecord) {
  return {
    id: receipt.id,
    purchase_id: receipt.purchaseId,
    status: receipt.status,
    delivery_reference: receipt.deliveryReference,
    total_cost: receipt.totalCost,
    created_at: receipt.createdAt.toISOString(),
  };
}
