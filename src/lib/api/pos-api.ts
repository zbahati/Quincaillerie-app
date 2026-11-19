import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface PosBranch { id: string; name: string; is_active: boolean }
export interface PosPaymentAccount {
  id: string;
  account_type: "cash_drawer" | "bank" | "mtn_wallet" | "airtel_wallet";
  name: string;
}

export interface PosProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  base_unit_name: string;
  selling_price: number;
  quantity_on_hand: number;
  base_unit_allows_decimals: boolean;
}

export interface PosProductPage { items: PosProduct[]; total_count: number }

export interface SaleReceipt {
  id: string;
  transaction_number: string;
  payment_method: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  customer_name: string | null;
  created_at: string;
  items: Array<{
    product_name: string;
    sku: string;
    quantity: number;
    unit_name: string;
    listed_unit_price: number;
    unit_price: number;
    line_total: number;
    price_change_reason: string | null;
  }>;
  payments: Array<{ payment_method: string; amount: number }>;
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isPosPaymentAccountType(value: unknown): value is PosPaymentAccount["account_type"] {
  return value === "cash_drawer" || value === "bank" || value === "mtn_wallet" || value === "airtel_wallet";
}

export const posApi = {
  async branches(): Promise<PosBranch[]> {
    const value = await requestJson("/api/pos/branches");
    if (!isRecord(value) || !Array.isArray(value.branches)) {
      throw invalidResponse("The service returned invalid POS branches.");
    }
    return value.branches.map((branch) => {
      if (!isRecord(branch) || typeof branch.id !== "string" || typeof branch.name !== "string" || typeof branch.is_active !== "boolean") {
        throw invalidResponse("The service returned invalid POS branch information.");
      }
      return { id: branch.id, name: branch.name, is_active: branch.is_active };
    });
  },

  async paymentAccounts(branchId: string): Promise<PosPaymentAccount[]> {
    const params = new URLSearchParams({ branchId });
    const value = await requestJson(`/api/pos/payment-options?${params.toString()}`);
    if (!isRecord(value) || !Array.isArray(value.accounts)) {
      throw invalidResponse("The service returned invalid POS payment accounts.");
    }
    return value.accounts.map((account) => {
      if (
        !isRecord(account) ||
        typeof account.id !== "string" ||
        typeof account.name !== "string" ||
        !isPosPaymentAccountType(account.account_type)
      ) {
        throw invalidResponse("The service returned invalid POS payment-account information.");
      }
      return {
        id: account.id,
        name: account.name,
        account_type: account.account_type,
      };
    });
  },

  async products(input: { branchId: string; search: string; offset: number; limit: number }): Promise<PosProductPage> {
    const params = new URLSearchParams({
      branchId: input.branchId,
      offset: String(input.offset),
      limit: String(input.limit),
    });
    if (input.search) params.set("search", input.search);
    const value = await requestJson(`/api/pos/products?${params.toString()}`);
    if (!isRecord(value) || !Array.isArray(value.items) || !safeInteger(value.total_count)) {
      throw invalidResponse("The service returned invalid POS products.");
    }
    const items = value.items.map((item) => {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.name !== "string" ||
        typeof item.sku !== "string" ||
        (item.barcode !== null && typeof item.barcode !== "string") ||
        typeof item.base_unit_name !== "string" ||
        !safeInteger(item.selling_price) ||
        item.selling_price < 0 ||
        !safeInteger(item.quantity_on_hand) ||
        item.quantity_on_hand < 0 ||
        typeof item.base_unit_allows_decimals !== "boolean"
      ) {
        throw invalidResponse("The service returned invalid POS product information.");
      }
      return {
        id: item.id,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        base_unit_name: item.base_unit_name,
        selling_price: item.selling_price,
        quantity_on_hand: item.quantity_on_hand,
        base_unit_allows_decimals: item.base_unit_allows_decimals,
      };
    });
    return { items, total_count: value.total_count };
  },

  async checkout(input: {
    branchId: string;
    customerId: string | null;
    items: Array<{ productId: string; quantity: number; sellingPrice: number | null; priceChangeReason: string | null }>;
    payments: Array<{
      paymentMethod: "cash" | "mtn_mobile_money" | "airtel_money" | "bank_transfer";
      amount: number;
      cashAccountId: string;
    }>;
  }): Promise<SaleReceipt> {
    const value = await requestJson("/api/pos/checkout", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!isRecord(value) || !isRecord(value.receipt)) {
      throw invalidResponse("The service returned an invalid POS receipt.");
    }
    const receipt = value.receipt;
    if (
      typeof receipt.id !== "string" ||
      typeof receipt.transaction_number !== "string" ||
      typeof receipt.payment_method !== "string" ||
      !safeInteger(receipt.total) ||
      !safeInteger(receipt.amount_paid) ||
      !safeInteger(receipt.balance_due) ||
      (receipt.customer_name !== null && typeof receipt.customer_name !== "string") ||
      typeof receipt.created_at !== "string" ||
      !Array.isArray(receipt.items) ||
      !Array.isArray(receipt.payments)
    ) {
      throw invalidResponse("The service returned invalid POS receipt information.");
    }
    return receipt as unknown as SaleReceipt;
  },
};
