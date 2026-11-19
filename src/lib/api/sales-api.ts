import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface SalesBranch { id: string; name: string; is_active: boolean }

export interface SaleHistoryItem {
  product_name: string;
  sku: string;
  quantity: number;
  unit_name: string;
  unit_price: number;
  line_total: number;
}

export interface SaleHistoryPayment {
  payment_method: string;
  amount: number;
}

export interface SaleHistoryEntry {
  id: string;
  transaction_number: string;
  status: "completed" | "cancelled";
  customer_name: string | null;
  sold_by: string | null;
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  item_quantity: number;
  created_at: string;
  items: SaleHistoryItem[];
  payments: SaleHistoryPayment[];
}

export interface SalesHistoryPage {
  items: SaleHistoryEntry[];
  total_count: number;
  completed_sales_total: number;
  collected_at_sale_total: number;
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function parseEntry(value: unknown): SaleHistoryEntry {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.transaction_number !== "string" ||
    (value.status !== "completed" && value.status !== "cancelled") ||
    (value.customer_name !== null && typeof value.customer_name !== "string") ||
    (value.sold_by !== null && typeof value.sold_by !== "string") ||
    !safeInteger(value.subtotal) ||
    !safeInteger(value.discount) ||
    !safeInteger(value.total) ||
    !safeInteger(value.amount_paid) ||
    !safeInteger(value.balance_due) ||
    !safeInteger(value.item_quantity) ||
    typeof value.created_at !== "string" ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.payments)
  ) {
    throw invalidResponse("The service returned invalid sale history information.");
  }
  return {
    id: value.id,
    transaction_number: value.transaction_number,
    status: value.status,
    customer_name: value.customer_name,
    sold_by: value.sold_by,
    subtotal: value.subtotal,
    discount: value.discount,
    total: value.total,
    amount_paid: value.amount_paid,
    balance_due: value.balance_due,
    item_quantity: value.item_quantity,
    created_at: value.created_at,
    items: value.items.map((item) => {
      if (
        !isRecord(item) ||
        typeof item.product_name !== "string" ||
        typeof item.sku !== "string" ||
        !safeInteger(item.quantity) ||
        typeof item.unit_name !== "string" ||
        !safeInteger(item.unit_price) ||
        !safeInteger(item.line_total)
      ) {
        throw invalidResponse("The service returned invalid sale line information.");
      }
      return {
        product_name: item.product_name,
        sku: item.sku,
        quantity: item.quantity,
        unit_name: item.unit_name,
        unit_price: item.unit_price,
        line_total: item.line_total,
      };
    }),
    payments: value.payments.map((payment) => {
      if (
        !isRecord(payment) ||
        typeof payment.payment_method !== "string" ||
        !safeInteger(payment.amount)
      ) {
        throw invalidResponse("The service returned invalid sale payment information.");
      }
      return { payment_method: payment.payment_method, amount: payment.amount };
    }),
  };
}

export const salesApi = {
  async branches(): Promise<SalesBranch[]> {
    const value = await requestJson("/api/sales/branches");
    if (!isRecord(value) || !Array.isArray(value.branches)) {
      throw invalidResponse("The service returned invalid sales branches.");
    }
    return value.branches.map((branch) => {
      if (!isRecord(branch) || typeof branch.id !== "string" || typeof branch.name !== "string" || typeof branch.is_active !== "boolean") {
        throw invalidResponse("The service returned invalid sales branch information.");
      }
      return { id: branch.id, name: branch.name, is_active: branch.is_active };
    });
  },
  async list(input: {
    branchId: string;
    search: string;
    fromDate: string;
    toDate: string;
    offset: number;
    limit: number;
  }): Promise<SalesHistoryPage> {
    const params = new URLSearchParams({
      branchId: input.branchId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      offset: String(input.offset),
      limit: String(input.limit),
    });
    if (input.search) params.set("search", input.search);
    const value = await requestJson(`/api/sales?${params.toString()}`);
    if (
      !isRecord(value) ||
      !Array.isArray(value.items) ||
      !safeInteger(value.total_count) ||
      !safeInteger(value.completed_sales_total) ||
      !safeInteger(value.collected_at_sale_total)
    ) {
      throw invalidResponse("The service returned invalid sales history.");
    }
    return {
      items: value.items.map(parseEntry),
      total_count: value.total_count,
      completed_sales_total: value.completed_sales_total,
      collected_at_sale_total: value.collected_at_sale_total,
    };
  },
};
