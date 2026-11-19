import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface InventoryBranch {
  id: string;
  name: string;
  is_active: boolean;
}

export interface InventoryItem {
  product_id: string;
  name: string;
  sku: string;
  base_unit_name: string;
  quantity_on_hand: number;
  stock_value: number;
  purchase_price: number;
  selling_price: number;
  minimum_selling_price: number;
  min_stock_quantity: number;
  base_unit_allows_decimals: boolean;
  has_movements: boolean;
}

export interface InventoryPage {
  items: InventoryItem[];
  total_count: number;
  total_stock_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
}

export interface StockMovement {
  id: string;
  business_id: string;
  branch_id: string;
  product_id: string;
  product_name: string;
  movement_type: string;
  quantity_delta: number;
  unit_cost: number | null;
  total_cost: number | null;
  previous_quantity: number;
  new_quantity: number;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  user_id: string | null;
  created_at: string;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseBranch(value: unknown): InventoryBranch {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.is_active !== "boolean"
  ) {
    throw invalidResponse("The service returned invalid inventory branch information.");
  }
  return { id: value.id, name: value.name, is_active: value.is_active };
}

function parseBranches(value: unknown): InventoryBranch[] {
  if (!isRecord(value) || !Array.isArray(value.branches)) {
    throw invalidResponse("The service returned invalid inventory branches.");
  }
  return value.branches.map(parseBranch);
}

function parseInventoryItem(value: unknown): InventoryItem {
  if (
    !isRecord(value) ||
    typeof value.product_id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.sku !== "string" ||
    typeof value.base_unit_name !== "string" ||
    !isSafeNonNegativeInteger(value.quantity_on_hand) ||
    !isSafeNonNegativeInteger(value.stock_value) ||
    !isSafeNonNegativeInteger(value.purchase_price) ||
    !isSafeNonNegativeInteger(value.selling_price) ||
    !isSafeNonNegativeInteger(value.minimum_selling_price) ||
    !isSafeNonNegativeInteger(value.min_stock_quantity) ||
    typeof value.base_unit_allows_decimals !== "boolean" ||
    typeof value.has_movements !== "boolean"
  ) {
    throw invalidResponse("The service returned invalid inventory information.");
  }
  return {
    product_id: value.product_id,
    name: value.name,
    sku: value.sku,
    base_unit_name: value.base_unit_name,
    quantity_on_hand: value.quantity_on_hand,
    stock_value: value.stock_value,
    purchase_price: value.purchase_price,
    selling_price: value.selling_price,
    minimum_selling_price: value.minimum_selling_price,
    min_stock_quantity: value.min_stock_quantity,
    base_unit_allows_decimals: value.base_unit_allows_decimals,
    has_movements: value.has_movements,
  };
}

function parseInventoryPage(value: unknown): InventoryPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !isSafeNonNegativeInteger(value.total_count) ||
    !isSafeNonNegativeInteger(value.total_stock_value) ||
    !isSafeNonNegativeInteger(value.low_stock_count) ||
    !isSafeNonNegativeInteger(value.out_of_stock_count)
  ) {
    throw invalidResponse("The service returned an invalid inventory page.");
  }
  return {
    items: value.items.map(parseInventoryItem),
    total_count: value.total_count,
    total_stock_value: value.total_stock_value,
    low_stock_count: value.low_stock_count,
    out_of_stock_count: value.out_of_stock_count,
  };
}

function parseStockMovement(value: unknown): StockMovement {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.business_id !== "string" ||
    typeof value.branch_id !== "string" ||
    typeof value.product_id !== "string" ||
    typeof value.product_name !== "string" ||
    typeof value.movement_type !== "string" ||
    !isSafeInteger(value.quantity_delta) ||
    (value.unit_cost !== null && !isSafeNonNegativeInteger(value.unit_cost)) ||
    (value.total_cost !== null && !isSafeNonNegativeInteger(value.total_cost)) ||
    !isSafeNonNegativeInteger(value.previous_quantity) ||
    !isSafeNonNegativeInteger(value.new_quantity) ||
    !nullableString(value.reference_type) ||
    !nullableString(value.reference_id) ||
    !nullableString(value.reason) ||
    !nullableString(value.user_id) ||
    typeof value.created_at !== "string"
  ) {
    throw invalidResponse("The service returned invalid stock movement information.");
  }
  return {
    id: value.id,
    business_id: value.business_id,
    branch_id: value.branch_id,
    product_id: value.product_id,
    product_name: value.product_name,
    movement_type: value.movement_type,
    quantity_delta: value.quantity_delta,
    unit_cost: value.unit_cost,
    total_cost: value.total_cost,
    previous_quantity: value.previous_quantity,
    new_quantity: value.new_quantity,
    reference_type: value.reference_type,
    reference_id: value.reference_id,
    reason: value.reason,
    user_id: value.user_id,
    created_at: value.created_at,
  };
}

function parseMovements(value: unknown): StockMovement[] {
  if (!isRecord(value) || !Array.isArray(value.movements)) {
    throw invalidResponse("The service returned invalid stock movements.");
  }
  return value.movements.map(parseStockMovement);
}

function parseMovement(value: unknown): StockMovement {
  if (!isRecord(value) || !("movement" in value)) {
    throw invalidResponse("The service returned an invalid stock movement response.");
  }
  return parseStockMovement(value.movement);
}

async function postJson(path: string, input: unknown): Promise<unknown> {
  return requestJson(path, { method: "POST", body: JSON.stringify(input) });
}

export const inventoryApi = {
  async branches(): Promise<InventoryBranch[]> {
    return parseBranches(await requestJson("/api/inventory/branches"));
  },

  async list(input: {
    branchId: string;
    search: string;
    offset: number;
    limit: number;
  }): Promise<InventoryPage> {
    const parameters = new URLSearchParams({
      branchId: input.branchId,
      offset: String(input.offset),
      limit: String(input.limit),
    });
    if (input.search) {
      parameters.set("search", input.search);
    }
    return parseInventoryPage(await requestJson(`/api/inventory?${parameters.toString()}`));
  },

  async movements(input: {
    branchId: string;
    productId: string;
    offset: number;
    limit: number;
  }): Promise<StockMovement[]> {
    const parameters = new URLSearchParams({
      branchId: input.branchId,
      offset: String(input.offset),
      limit: String(input.limit),
    });
    return parseMovements(
      await requestJson(
        `/api/inventory/${encodeURIComponent(input.productId)}/movements?${parameters.toString()}`,
      ),
    );
  },

  async setOpeningStock(
    productId: string,
    input: { branchId: string; quantity: number; reason: string | null },
  ): Promise<StockMovement> {
    return parseMovement(
      await postJson(
        `/api/inventory/${encodeURIComponent(productId)}/opening-stock`,
        input,
      ),
    );
  },

  async correctStock(
    productId: string,
    input: { branchId: string; targetQuantity: number; reason: string },
  ): Promise<StockMovement> {
    return parseMovement(
      await postJson(
        `/api/inventory/${encodeURIComponent(productId)}/correction`,
        input,
      ),
    );
  },

  async receiveStock(
    productId: string,
    input: {
      branchId: string;
      quantity: number;
      receivedUnitCost: number;
      receiptReference: string;
      reason: string | null;
      newSellingPrice: number | null;
    },
  ): Promise<StockMovement> {
    return parseMovement(
      await postJson(
        `/api/inventory/${encodeURIComponent(productId)}/receipts`,
        input,
      ),
    );
  },
};
