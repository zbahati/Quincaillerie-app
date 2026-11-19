import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import {
  handleAuthRouteError,
  requestSessionToken,
} from "@/lib/server/auth/http";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { productIdSchema } from "@/lib/server/schemas/products";
import type { InventoryBranchRecord, InventoryItemRecord, InventoryPageRecord, StockMovementRecord } from "@/lib/server/repositories/inventory";
import type { NextRequest } from "next/server";

export async function authenticatedContext(request: NextRequest) {
  const context = await findAuthenticatedContext(requestSessionToken(request));
  if (!context) {
    throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
  }
  return context;
}

export function parseProductId(value: string): string {
  const parsed = productIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AuthServiceError(400, "invalid_product_id", "The product ID is invalid.");
  }
  return parsed.data;
}

export function inventoryBranchDto(branch: InventoryBranchRecord) {
  return {
    id: branch.id,
    name: branch.name,
    is_active: branch.isActive,
  };
}

function inventoryItemDto(item: InventoryItemRecord) {
  return {
    product_id: item.productId,
    name: item.name,
    sku: item.sku,
    base_unit_name: item.baseUnitName,
    quantity_on_hand: item.quantityOnHand,
    stock_value: item.stockValue,
    purchase_price: item.purchasePrice,
    selling_price: item.sellingPrice,
    minimum_selling_price: item.minimumSellingPrice,
    min_stock_quantity: item.minStockQuantity,
    base_unit_allows_decimals: item.baseUnitAllowsDecimals,
    has_movements: item.hasMovements,
  };
}

export function inventoryPageDto(page: InventoryPageRecord) {
  return {
    items: page.items.map(inventoryItemDto),
    total_count: page.totalCount,
    total_stock_value: page.totalStockValue,
    low_stock_count: page.lowStockCount,
    out_of_stock_count: page.outOfStockCount,
  };
}

export function stockMovementDto(movement: StockMovementRecord) {
  return {
    id: movement.id,
    business_id: movement.businessId,
    branch_id: movement.branchId,
    product_id: movement.productId,
    product_name: movement.productName,
    movement_type: movement.movementType,
    quantity_delta: movement.quantityDelta,
    unit_cost: movement.unitCost,
    total_cost: movement.totalCost,
    previous_quantity: movement.previousQuantity,
    new_quantity: movement.newQuantity,
    reference_type: movement.referenceType,
    reference_id: movement.referenceId,
    reason: movement.reason,
    user_id: movement.userId,
    created_at: movement.createdAt.toISOString(),
  };
}

export { handleAuthRouteError };
