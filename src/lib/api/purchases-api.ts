import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface PurchaseBranch {
  id: string;
  name: string;
  is_active: boolean;
}

export interface PurchaseProduct {
  id: string;
  name: string;
  sku: string;
  base_unit_name: string;
  purchase_price: number;
  base_unit_allows_decimals: boolean;
}

export interface PurchaseItem {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  unit_name: string;
  ordered_quantity: number;
  received_quantity: number;
  unit_cost: number;
  line_total: number;
  base_unit_allows_decimals: boolean;
}

export interface PurchaseDelivery {
  id: string;
  delivery_reference: string | null;
  notes: string | null;
  total_cost: number;
  created_at: string;
  items: Array<{
    product_name: string;
    quantity: number;
    unit_name: string;
    total_cost: number;
  }>;
}

export interface Purchase {
  id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_invoice_number: string;
  status: "pending" | "partially_received" | "received";
  subtotal: number;
  amount_paid: number;
  balance_due: number;
  duplicate_authorized: boolean;
  duplicate_of_purchase_id: string | null;
  created_at: string;
  items: PurchaseItem[];
  deliveries: PurchaseDelivery[];
  payments: Array<{
    id: string;
    payment_method: "cash" | "mtn_mobile_money" | "airtel_money" | "bank_transfer";
    amount: number;
    created_at: string;
  }>;
}

export interface PurchasePaymentOption {
  id: string;
  account_type: "cash_drawer" | "bank" | "mtn_wallet" | "airtel_wallet" | "other";
  name: string;
  available_balance: number;
}

export interface PurchaseHistory {
  items: Purchase[];
  total_count: number;
  purchase_total: number;
  paid_total: number;
  balance_due_total: number;
}

export interface PurchaseReceipt {
  id: string;
  purchase_id: string;
  status: "pending" | "partially_received" | "received";
  delivery_reference: string | null;
  total_cost: number;
  created_at: string;
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function parseBranches(value: unknown): PurchaseBranch[] {
  if (!isRecord(value) || !Array.isArray(value.branches)) {
    throw invalidResponse("The service returned invalid purchase branches.");
  }
  return value.branches.map((branch) => {
    if (!isRecord(branch) || typeof branch.id !== "string" || typeof branch.name !== "string" || typeof branch.is_active !== "boolean") {
      throw invalidResponse("The service returned invalid purchase branch information.");
    }
    return { id: branch.id, name: branch.name, is_active: branch.is_active };
  });
}

function parsePurchaseProduct(value: unknown): PurchaseProduct {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.sku !== "string" ||
    typeof value.base_unit_name !== "string" ||
    !safeInteger(value.purchase_price) ||
    value.purchase_price < 0 ||
    typeof value.base_unit_allows_decimals !== "boolean"
  ) {
    throw invalidResponse("The service returned invalid purchase product information.");
  }
  return {
    id: value.id,
    name: value.name,
    sku: value.sku,
    base_unit_name: value.base_unit_name,
    purchase_price: value.purchase_price,
    base_unit_allows_decimals: value.base_unit_allows_decimals,
  };
}

function parsePurchase(value: unknown): Purchase {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.supplier_id !== "string" ||
    typeof value.supplier_name !== "string" ||
    typeof value.supplier_invoice_number !== "string" ||
    !["pending", "partially_received", "received"].includes(String(value.status)) ||
    !safeInteger(value.subtotal) ||
    value.subtotal < 0 ||
    !safeInteger(value.amount_paid) ||
    value.amount_paid < 0 ||
    !safeInteger(value.balance_due) ||
    value.balance_due < 0 ||
    typeof value.duplicate_authorized !== "boolean" ||
    (value.duplicate_of_purchase_id !== null && typeof value.duplicate_of_purchase_id !== "string") ||
    typeof value.created_at !== "string" ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.deliveries) ||
    !Array.isArray(value.payments)
  ) {
    throw invalidResponse("The service returned invalid purchase information.");
  }
  return {
    id: value.id,
    supplier_id: value.supplier_id,
    supplier_name: value.supplier_name,
    supplier_invoice_number: value.supplier_invoice_number,
    status: value.status as Purchase["status"],
    subtotal: value.subtotal,
    amount_paid: value.amount_paid,
    balance_due: value.balance_due,
    duplicate_authorized: value.duplicate_authorized,
    duplicate_of_purchase_id: value.duplicate_of_purchase_id,
    created_at: value.created_at,
    items: value.items.map((item) => {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.product_id !== "string" ||
        typeof item.product_name !== "string" ||
        typeof item.sku !== "string" ||
        typeof item.unit_name !== "string" ||
        !safeInteger(item.ordered_quantity) ||
        !safeInteger(item.received_quantity) ||
        !safeInteger(item.unit_cost) ||
        !safeInteger(item.line_total) ||
        typeof item.base_unit_allows_decimals !== "boolean"
      ) {
        throw invalidResponse("The service returned invalid purchase line information.");
      }
      return {
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        sku: item.sku,
        unit_name: item.unit_name,
        ordered_quantity: item.ordered_quantity,
        received_quantity: item.received_quantity,
        unit_cost: item.unit_cost,
        line_total: item.line_total,
        base_unit_allows_decimals: item.base_unit_allows_decimals,
      };
    }),
    deliveries: value.deliveries.map((delivery) => {
      if (
        !isRecord(delivery) ||
        typeof delivery.id !== "string" ||
        (delivery.delivery_reference !== null && typeof delivery.delivery_reference !== "string") ||
        (delivery.notes !== null && typeof delivery.notes !== "string") ||
        !safeInteger(delivery.total_cost) ||
        typeof delivery.created_at !== "string" ||
        !Array.isArray(delivery.items)
      ) {
        throw invalidResponse("The service returned invalid purchase delivery information.");
      }
      return {
        id: delivery.id,
        delivery_reference: delivery.delivery_reference,
        notes: delivery.notes,
        total_cost: delivery.total_cost,
        created_at: delivery.created_at,
        items: delivery.items.map((item) => {
          if (
            !isRecord(item) ||
            typeof item.product_name !== "string" ||
            !safeInteger(item.quantity) ||
            typeof item.unit_name !== "string" ||
            !safeInteger(item.total_cost)
          ) {
            throw invalidResponse("The service returned invalid purchase delivery line information.");
          }
          return {
            product_name: item.product_name,
            quantity: item.quantity,
            unit_name: item.unit_name,
            total_cost: item.total_cost,
          };
        }),
      };
    }),
    payments: value.payments.map((payment) => {
      if (
        !isRecord(payment) ||
        typeof payment.id !== "string" ||
        !["cash", "mtn_mobile_money", "airtel_money", "bank_transfer"].includes(String(payment.payment_method)) ||
        !safeInteger(payment.amount) ||
        payment.amount <= 0 ||
        typeof payment.created_at !== "string"
      ) {
        throw invalidResponse("The service returned invalid supplier payment information.");
      }
      return {
        id: payment.id,
        payment_method: payment.payment_method as Purchase["payments"][number]["payment_method"],
        amount: payment.amount,
        created_at: payment.created_at,
      };
    }),
  };
}

function parsePaymentOptions(value: unknown): PurchasePaymentOption[] {
  if (!isRecord(value) || !Array.isArray(value.accounts)) {
    throw invalidResponse("The service returned invalid supplier payment accounts.");
  }
  return value.accounts.map((account) => {
    if (
      !isRecord(account) ||
      typeof account.id !== "string" ||
      !["cash_drawer", "bank", "mtn_wallet", "airtel_wallet", "other"].includes(String(account.account_type)) ||
      typeof account.name !== "string" ||
      !safeInteger(account.available_balance) ||
      account.available_balance < 0
    ) {
      throw invalidResponse("The service returned invalid supplier payment account information.");
    }
    return {
      id: account.id,
      account_type: account.account_type as PurchasePaymentOption["account_type"],
      name: account.name,
      available_balance: account.available_balance,
    };
  });
}

export const purchasesApi = {
  async branches(): Promise<PurchaseBranch[]> {
    return parseBranches(await requestJson("/api/purchases/branches"));
  },
  async products(): Promise<PurchaseProduct[]> {
    const value = await requestJson("/api/purchases/products");
    if (!isRecord(value) || !Array.isArray(value.products)) {
      throw invalidResponse("The service returned invalid purchase products.");
    }
    return value.products.map(parsePurchaseProduct);
  },
  async list(branchId: string): Promise<Purchase[]> {
    const value = await requestJson(`/api/purchases?branchId=${encodeURIComponent(branchId)}`);
    if (!isRecord(value) || !Array.isArray(value.purchases)) {
      throw invalidResponse("The service returned invalid purchases.");
    }
    return value.purchases.map(parsePurchase);
  },
  async paymentOptions(branchId: string): Promise<PurchasePaymentOption[]> {
    return parsePaymentOptions(await requestJson(`/api/purchases/payment-options?branchId=${encodeURIComponent(branchId)}`));
  },
  async history(input: {
    branchId: string;
    search: string;
    fromDate: string;
    toDate: string;
    offset: number;
    limit: number;
  }): Promise<PurchaseHistory> {
    const query = new URLSearchParams({
      branchId: input.branchId,
      search: input.search,
      fromDate: input.fromDate,
      toDate: input.toDate,
      offset: String(input.offset),
      limit: String(input.limit),
    });
    const value = await requestJson(`/api/purchases/history?${query.toString()}`);
    if (
      !isRecord(value) ||
      !Array.isArray(value.items) ||
      !safeInteger(value.total_count) ||
      !safeInteger(value.purchase_total) ||
      !safeInteger(value.paid_total) ||
      !safeInteger(value.balance_due_total)
    ) {
      throw invalidResponse("The service returned invalid purchase history.");
    }
    return {
      items: value.items.map(parsePurchase),
      total_count: value.total_count,
      purchase_total: value.purchase_total,
      paid_total: value.paid_total,
      balance_due_total: value.balance_due_total,
    };
  },
  async recordPayment(purchaseId: string, input: {
    branchId: string;
    amount: number;
    paymentMethod: Purchase["payments"][number]["payment_method"];
    cashAccountId: string;
  }): Promise<Purchase> {
    const value = await requestJson(`/api/purchases/${encodeURIComponent(purchaseId)}/payments`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!isRecord(value) || !("purchase" in value)) {
      throw invalidResponse("The service returned an invalid supplier payment response.");
    }
    return parsePurchase(value.purchase);
  },
  async create(input: {
    branchId: string;
    supplierId: string;
    supplierInvoiceNumber: string;
    authorizeDuplicate: boolean;
    items: Array<{ productId: string; orderedQuantity: number; unitCost: number }>;
  }): Promise<Purchase> {
    const value = await requestJson("/api/purchases", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!isRecord(value) || !("purchase" in value)) {
      throw invalidResponse("The service returned an invalid purchase response.");
    }
    return parsePurchase(value.purchase);
  },
  async receive(purchaseId: string, input: {
    branchId: string;
    deliveryReference: string | null;
    notes: string | null;
    items: Array<{ purchaseItemId: string; quantity: number }>;
  }): Promise<PurchaseReceipt> {
    const value = await requestJson(`/api/purchases/${encodeURIComponent(purchaseId)}/receipts`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!isRecord(value) || !isRecord(value.receipt)) {
      throw invalidResponse("The service returned an invalid purchase receipt.");
    }
    const receipt = value.receipt;
    if (
      typeof receipt.id !== "string" ||
      typeof receipt.purchase_id !== "string" ||
      !["pending", "partially_received", "received"].includes(String(receipt.status)) ||
      (receipt.delivery_reference !== null && typeof receipt.delivery_reference !== "string") ||
      !safeInteger(receipt.total_cost) ||
      typeof receipt.created_at !== "string"
    ) {
      throw invalidResponse("The service returned invalid purchase receipt information.");
    }
    return {
      id: receipt.id,
      purchase_id: receipt.purchase_id,
      status: receipt.status as PurchaseReceipt["status"],
      delivery_reference: receipt.delivery_reference,
      total_cost: receipt.total_cost,
      created_at: receipt.created_at,
    };
  },
};
