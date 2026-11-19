import "server-only";

import type { Pool, PoolClient } from "pg";

import type {
  InventoryListQuery,
  OpeningStockInput,
  StockCorrectionInput,
  StockMovementListQuery,
  StockReceiptInput,
} from "@/lib/server/schemas/inventory";

export type InventoryExecutor = Pool | PoolClient;

export class InventoryRuleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "InventoryRuleError";
  }
}

export interface InventoryBranchRecord {
  id: string;
  name: string;
  isActive: boolean;
}

export interface InventoryItemRecord {
  productId: string;
  name: string;
  sku: string;
  baseUnitName: string;
  quantityOnHand: number;
  stockValue: number;
  purchasePrice: number;
  sellingPrice: number;
  minimumSellingPrice: number;
  minStockQuantity: number;
  baseUnitAllowsDecimals: boolean;
  hasMovements: boolean;
}

export interface InventoryPageRecord {
  items: InventoryItemRecord[];
  totalCount: number;
  totalStockValue: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface StockMovementRecord {
  id: string;
  businessId: string;
  branchId: string;
  productId: string;
  productName: string;
  movementType: string;
  quantityDelta: number;
  unitCost: number | null;
  totalCost: number | null;
  previousQuantity: number;
  newQuantity: number;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  userId: string | null;
  createdAt: Date;
}

interface InventoryItemRow extends Omit<
  InventoryItemRecord,
  | "quantityOnHand"
  | "stockValue"
  | "purchasePrice"
  | "sellingPrice"
  | "minimumSellingPrice"
  | "minStockQuantity"
> {
  quantityOnHand: string;
  layerQuantity: string;
  stockValue: string;
  purchasePrice: string;
  sellingPrice: string;
  minimumSellingPrice: string;
  minStockQuantity: string;
}

interface StockMovementRow extends Omit<
  StockMovementRecord,
  "quantityDelta" | "unitCost" | "totalCost" | "previousQuantity" | "newQuantity"
> {
  quantityDelta: string;
  unitCost: string | null;
  totalCost: string | null;
  previousQuantity: string;
  newQuantity: string;
}

function safeInteger(value: string, field: string, allowNegative = false): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (!allowNegative && parsed < 0)) {
    throw new Error(`The stored ${field} exceeds the browser's safe integer range.`);
  }
  return parsed;
}

function toSafeInteger(value: bigint, field: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new InventoryRuleError(400, "value_too_large", `${field} exceeds the supported limit.`);
  }
  return Number(value);
}

function stockValue(quantity: number, unitCost: number): number {
  return toSafeInteger(
    (BigInt(quantity) * BigInt(unitCost) + 500n) / 1000n,
    "Stock valuation",
  );
}

function mapInventoryItem(row: InventoryItemRow): InventoryItemRecord {
  const quantityOnHand = safeInteger(row.quantityOnHand, "stock quantity");
  if (safeInteger(row.layerQuantity, "cost-layer quantity") !== quantityOnHand) {
    throw new Error(`Inventory quantity and purchase-cost layers do not match for ${row.name}.`);
  }
  return {
    productId: row.productId,
    name: row.name,
    sku: row.sku,
    baseUnitName: row.baseUnitName,
    quantityOnHand,
    stockValue: safeInteger(row.stockValue, "stock value"),
    purchasePrice: safeInteger(row.purchasePrice, "purchase price"),
    sellingPrice: safeInteger(row.sellingPrice, "selling price"),
    minimumSellingPrice: safeInteger(row.minimumSellingPrice, "minimum selling price"),
    minStockQuantity: safeInteger(row.minStockQuantity, "minimum stock quantity"),
    baseUnitAllowsDecimals: row.baseUnitAllowsDecimals,
    hasMovements: row.hasMovements,
  };
}

function mapStockMovement(row: StockMovementRow): StockMovementRecord {
  return {
    ...row,
    quantityDelta: safeInteger(row.quantityDelta, "movement quantity", true),
    unitCost: row.unitCost === null ? null : safeInteger(row.unitCost, "movement unit cost"),
    totalCost: row.totalCost === null ? null : safeInteger(row.totalCost, "movement total cost"),
    previousQuantity: safeInteger(row.previousQuantity, "previous stock quantity"),
    newQuantity: safeInteger(row.newQuantity, "new stock quantity"),
  };
}

function inventorySearchClause(parameterIndex: number): string {
  const searchParameter = `$${parameterIndex}`;
  return `(
    ${searchParameter}::text IS NULL OR
    p.name ILIKE ${searchParameter} ESCAPE '!' OR
    p.sku ILIKE ${searchParameter} ESCAPE '!' OR
    COALESCE(p.barcode, '') ILIKE ${searchParameter} ESCAPE '!' OR
    COALESCE(b.name, '') ILIKE ${searchParameter} ESCAPE '!' OR
    COALESCE(c.name, '') ILIKE ${searchParameter} ESCAPE '!' OR
    u.name ILIKE ${searchParameter} ESCAPE '!'
  )`;
}

export async function listInventory(
  executor: InventoryExecutor,
  businessId: string,
  branchId: string,
  query: InventoryListQuery,
): Promise<InventoryPageRecord> {
  const search = query.search?.trim() || null;
  const pattern = search
    ? `%${search.replace(/[!%_]/g, (character) => `!${character}`)}%`
    : null;
  const values = [businessId, branchId, pattern];

  const countResult = await executor.query<{ totalCount: string }>(
    `SELECT COUNT(*)::text AS "totalCount"
     FROM products p
     JOIN units u ON u.id = p.base_unit_id
     LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
     LEFT JOIN brands b ON b.id = p.brand_id AND b.business_id = p.business_id
     WHERE p.business_id = $1
       AND p.is_active = TRUE
       AND ${inventorySearchClause(2)}`,
    [businessId, pattern],
  );
  const totalCount = safeInteger(countResult.rows[0]?.totalCount ?? "0", "inventory count");

  const itemResult = await executor.query<InventoryItemRow>(
    `SELECT
       p.id AS "productId",
       p.name,
       p.sku,
       u.name AS "baseUnitName",
       COALESCE(ib.quantity_on_hand, 0)::text AS "quantityOnHand",
       COALESCE(branch_layers.quantity, 0)::text AS "layerQuantity",
       FLOOR((COALESCE(branch_layers.raw_value, 0) + 500) / 1000)::text AS "stockValue",
       p.purchase_price::text AS "purchasePrice",
       p.selling_price::text AS "sellingPrice",
       COALESCE(business_layers.max_unit_cost, p.purchase_price::text)::text AS "minimumSellingPrice",
       p.min_stock_quantity::text AS "minStockQuantity",
       u.decimals_ok AS "baseUnitAllowsDecimals",
       EXISTS (
         SELECT 1
         FROM stock_movements sm
         WHERE sm.business_id = p.business_id
           AND sm.branch_id = $2
           AND sm.product_id = p.id
       ) AS "hasMovements"
     FROM products p
     JOIN units u ON u.id = p.base_unit_id
     LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
     LEFT JOIN brands b ON b.id = p.brand_id AND b.business_id = p.business_id
     LEFT JOIN inventory_balances ib
       ON ib.business_id = p.business_id
       AND ib.branch_id = $2
       AND ib.product_id = p.id
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(SUM(layer.quantity_remaining), 0) AS quantity,
         COALESCE(SUM(layer.quantity_remaining::numeric * layer.unit_cost::numeric), 0) AS raw_value
       FROM inventory_cost_layers AS layer
       WHERE layer.business_id = p.business_id
         AND layer.branch_id = $2
         AND layer.product_id = p.id
         AND layer.quantity_remaining > 0
     ) AS branch_layers ON TRUE
     LEFT JOIN LATERAL (
       SELECT MAX(layer.unit_cost)::text AS max_unit_cost
       FROM inventory_cost_layers AS layer
       WHERE layer.business_id = p.business_id
         AND layer.product_id = p.id
         AND layer.quantity_remaining > 0
     ) AS business_layers ON TRUE
     WHERE p.business_id = $1
       AND p.is_active = TRUE
       AND ${inventorySearchClause(3)}
     ORDER BY lower(p.name), p.id
     LIMIT $4 OFFSET $5`,
    [...values, query.limit, query.offset],
  );
  const items = itemResult.rows.map(mapInventoryItem);

  const summaryResult = await executor.query<{
    totalStockValue: string;
    lowStockCount: string;
    outOfStockCount: string;
  }>(
    `SELECT
       (SELECT FLOOR((COALESCE(SUM(layer.quantity_remaining::numeric * layer.unit_cost::numeric), 0) + 500) / 1000)::text
        FROM inventory_cost_layers AS layer
        WHERE layer.business_id = $1 AND layer.branch_id = $2) AS "totalStockValue",
       COUNT(*) FILTER (
         WHERE COALESCE(ib.quantity_on_hand, 0) > 0
           AND COALESCE(ib.quantity_on_hand, 0) <= p.min_stock_quantity
       )::text AS "lowStockCount",
       COUNT(*) FILTER (WHERE COALESCE(ib.quantity_on_hand, 0) = 0)::text AS "outOfStockCount"
     FROM products p
     LEFT JOIN inventory_balances ib
       ON ib.business_id = p.business_id AND ib.branch_id = $2 AND ib.product_id = p.id
     WHERE p.business_id = $1 AND p.is_active = TRUE`,
    [businessId, branchId],
  );
  const summary = summaryResult.rows[0];
  if (!summary) {
    throw new Error("PostgreSQL did not return the inventory summary.");
  }

  return {
    items,
    totalCount,
    totalStockValue: safeInteger(summary.totalStockValue, "total inventory value"),
    lowStockCount: safeInteger(summary.lowStockCount, "low-stock count"),
    outOfStockCount: safeInteger(summary.outOfStockCount, "out-of-stock count"),
  };
}

export async function listStockMovements(
  executor: InventoryExecutor,
  businessId: string,
  branchId: string,
  productId: string,
  query: StockMovementListQuery,
): Promise<StockMovementRecord[]> {
  const result = await executor.query<StockMovementRow>(
    `SELECT
       movement.id,
       movement.business_id AS "businessId",
       movement.branch_id AS "branchId",
       movement.product_id AS "productId",
       product.name AS "productName",
       movement.movement_type AS "movementType",
       movement.quantity_delta::text AS "quantityDelta",
       movement.unit_cost::text AS "unitCost",
       movement.total_cost::text AS "totalCost",
       movement.previous_quantity::text AS "previousQuantity",
       movement.new_quantity::text AS "newQuantity",
       movement.reference_type AS "referenceType",
       movement.reference_id AS "referenceId",
       movement.reason,
       movement.user_id AS "userId",
       movement.created_at AS "createdAt"
     FROM stock_movements AS movement
     JOIN products AS product
       ON product.business_id = movement.business_id AND product.id = movement.product_id
     WHERE movement.business_id = $1
       AND movement.branch_id = $2
       AND movement.product_id = $3
     ORDER BY movement.created_at DESC, movement.id DESC
     LIMIT $4 OFFSET $5`,
    [businessId, branchId, productId, query.limit, query.offset],
  );
  return result.rows.map(mapStockMovement);
}

export async function lockInventoryBranch(
  client: PoolClient,
  businessId: string,
  branchId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT id
     FROM branches
     WHERE business_id = $1 AND id = $2
     FOR SHARE`,
    [businessId, branchId],
  );
  if (result.rowCount !== 1) {
    throw new InventoryRuleError(404, "branch_not_found", "The branch is unavailable to this business.");
  }
}

interface LockedProduct {
  name: string;
  sku: string;
  baseUnitAllowsDecimals: boolean;
  baseUnitName: string;
  purchasePrice: number;
  sellingPrice: number;
}

export async function lockActiveProduct(
  client: PoolClient,
  businessId: string,
  productId: string,
): Promise<LockedProduct> {
  const result = await client.query<{
    name: string;
    sku: string;
    baseUnitAllowsDecimals: boolean;
    baseUnitName: string;
    purchasePrice: string;
    sellingPrice: string;
  }>(
    `SELECT
       product.name,
       product.sku,
       unit.decimals_ok AS "baseUnitAllowsDecimals",
       unit.name AS "baseUnitName",
       product.purchase_price::text AS "purchasePrice",
       product.selling_price::text AS "sellingPrice"
     FROM products AS product
     JOIN units AS unit ON unit.id = product.base_unit_id
     WHERE product.business_id = $1 AND product.id = $2 AND product.is_active = TRUE
     FOR UPDATE OF product`,
    [businessId, productId],
  );
  const product = result.rows[0];
  if (!product) {
    throw new InventoryRuleError(
      404,
      "product_not_found",
      "An active product belonging to this business is required.",
    );
  }
  return {
    name: product.name,
    sku: product.sku,
    baseUnitAllowsDecimals: product.baseUnitAllowsDecimals,
    baseUnitName: product.baseUnitName,
    purchasePrice: safeInteger(product.purchasePrice, "purchase price"),
    sellingPrice: safeInteger(product.sellingPrice, "selling price"),
  };
}

export async function currentBalance(
  client: PoolClient,
  businessId: string,
  branchId: string,
  productId: string,
): Promise<{ quantity: number; averageUnitCost: number } | null> {
  const result = await client.query<{ quantity: string; averageUnitCost: string }>(
    `SELECT
       quantity_on_hand::text AS quantity,
       average_unit_cost::text AS "averageUnitCost"
     FROM inventory_balances
     WHERE business_id = $1 AND branch_id = $2 AND product_id = $3
     FOR UPDATE`,
    [businessId, branchId, productId],
  );
  const balance = result.rows[0];
  return balance
    ? {
        quantity: safeInteger(balance.quantity, "stock quantity"),
        averageUnitCost: safeInteger(balance.averageUnitCost, "average unit cost"),
      }
    : null;
}

export async function saveBalance(
  client: PoolClient,
  businessId: string,
  branchId: string,
  productId: string,
  quantity: number,
  averageUnitCost: number,
): Promise<void> {
  await client.query(
    `INSERT INTO inventory_balances
       (business_id, branch_id, product_id, quantity_on_hand, average_unit_cost, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (business_id, branch_id, product_id)
     DO UPDATE SET
       quantity_on_hand = EXCLUDED.quantity_on_hand,
       average_unit_cost = EXCLUDED.average_unit_cost,
       updated_at = EXCLUDED.updated_at`,
    [businessId, branchId, productId, quantity, averageUnitCost],
  );
}

export async function insertMovement(
  client: PoolClient,
  input: Omit<StockMovementRecord, "id" | "createdAt">,
): Promise<StockMovementRecord> {
  const result = await client.query<{ id: string; createdAt: Date }>(
    `INSERT INTO stock_movements
       (business_id, branch_id, product_id, movement_type, quantity_delta, unit_cost,
        total_cost, previous_quantity, new_quantity, reference_type, reference_id,
        reason, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, created_at AS "createdAt"`,
    [
      input.businessId,
      input.branchId,
      input.productId,
      input.movementType,
      input.quantityDelta,
      input.unitCost,
      input.totalCost,
      input.previousQuantity,
      input.newQuantity,
      input.referenceType,
      input.referenceId,
      input.reason,
      input.userId,
    ],
  );
  const inserted = result.rows[0];
  if (!inserted) {
    throw new Error("PostgreSQL did not return the recorded stock movement.");
  }
  return { ...input, id: inserted.id, createdAt: inserted.createdAt };
}

export async function addCostLayer(
  client: PoolClient,
  input: {
    businessId: string;
    branchId: string;
    productId: string;
    sourceMovementId: string;
    sourceType: string;
    quantity: number;
    unitCost: number;
  },
): Promise<void> {
  if (input.quantity === 0) {
    return;
  }
  await client.query(
    `INSERT INTO inventory_cost_layers
       (business_id, branch_id, product_id, source_movement_id, source_type,
        quantity_received, quantity_remaining, unit_cost)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
    [
      input.businessId,
      input.branchId,
      input.productId,
      input.sourceMovementId,
      input.sourceType,
      input.quantity,
      input.unitCost,
    ],
  );
}

export async function consumeCostLayers(
  client: PoolClient,
  businessId: string,
  branchId: string,
  productId: string,
  quantity: number,
): Promise<{ unitCost: number; totalCost: number }> {
  const result = await client.query<{
    id: string;
    quantityRemaining: string;
    unitCost: string;
  }>(
    `SELECT
       id,
       quantity_remaining::text AS "quantityRemaining",
       unit_cost::text AS "unitCost"
     FROM inventory_cost_layers
     WHERE business_id = $1 AND branch_id = $2 AND product_id = $3
       AND quantity_remaining > 0
     ORDER BY created_at, id
     FOR UPDATE`,
    [businessId, branchId, productId],
  );
  let remaining = BigInt(quantity);
  let rawCost = 0n;

  for (const layer of result.rows) {
    if (remaining === 0n) {
      break;
    }
    const available = BigInt(safeInteger(layer.quantityRemaining, "cost-layer quantity"));
    const unitCost = BigInt(safeInteger(layer.unitCost, "cost-layer unit cost"));
    const consumed = remaining < available ? remaining : available;
    rawCost += consumed * unitCost;
    const updated = await client.query(
      `UPDATE inventory_cost_layers
       SET quantity_remaining = $1
       WHERE id = $2 AND business_id = $3 AND branch_id = $4
         AND product_id = $5 AND quantity_remaining = $6`,
      [
        Number(available - consumed),
        layer.id,
        businessId,
        branchId,
        productId,
        Number(available),
      ],
    );
    if (updated.rowCount !== 1) {
      throw new InventoryRuleError(
        409,
        "stock_layers_changed",
        "Stock cost layers changed while recording the transaction.",
      );
    }
    remaining -= consumed;
  }

  if (remaining > 0n) {
    throw new InventoryRuleError(
      409,
      "stock_cost_layers_inconsistent",
      "Purchase-cost layers do not cover the stock quantity. Correct inventory before continuing.",
    );
  }
  return {
    unitCost: toSafeInteger(
      (rawCost + BigInt(quantity) / 2n) / BigInt(quantity),
      "FIFO unit cost",
    ),
    totalCost: toSafeInteger((rawCost + 500n) / 1000n, "FIFO stock valuation"),
  };
}

function validateBaseUnitQuantity(quantity: number, allowsDecimals: boolean, label: string): void {
  if (!allowsDecimals && quantity % 1000 !== 0) {
    throw new InventoryRuleError(
      400,
      "fractional_base_unit_not_allowed",
      `${label} must be a whole base unit.`,
    );
  }
}

export async function setOpeningStock(
  client: PoolClient,
  input: OpeningStockInput & {
    businessId: string;
    branchId: string;
    productId: string;
    userId: string;
  },
): Promise<StockMovementRecord> {
  const product = await lockActiveProduct(client, input.businessId, input.productId);
  validateBaseUnitQuantity(input.quantity, product.baseUnitAllowsDecimals, "Opening quantity");
  const balance = await currentBalance(client, input.businessId, input.branchId, input.productId);
  const movementCheck = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM stock_movements
       WHERE business_id = $1 AND branch_id = $2 AND product_id = $3
     ) AS exists`,
    [input.businessId, input.branchId, input.productId],
  );
  if ((balance?.quantity ?? 0) !== 0 || movementCheck.rows[0]?.exists) {
    throw new InventoryRuleError(
      409,
      "opening_stock_already_recorded",
      "Opening stock can only be recorded once, before other stock movements in this branch.",
    );
  }

  const totalCost = stockValue(input.quantity, product.purchasePrice);
  await saveBalance(
    client,
    input.businessId,
    input.branchId,
    input.productId,
    input.quantity,
    product.purchasePrice,
  );
  const movement = await insertMovement(client, {
    businessId: input.businessId,
    branchId: input.branchId,
    productId: input.productId,
    productName: product.name,
    movementType: "opening_stock",
    quantityDelta: input.quantity,
    unitCost: product.purchasePrice,
    totalCost,
    previousQuantity: 0,
    newQuantity: input.quantity,
    referenceType: "product",
    referenceId: input.productId,
    reason: input.reason,
    userId: input.userId,
  });
  await addCostLayer(client, {
    businessId: input.businessId,
    branchId: input.branchId,
    productId: input.productId,
    sourceMovementId: movement.id,
    sourceType: "opening_stock",
    quantity: input.quantity,
    unitCost: product.purchasePrice,
  });
  return movement;
}

export async function correctStock(
  client: PoolClient,
  input: StockCorrectionInput & {
    businessId: string;
    branchId: string;
    productId: string;
    userId: string;
  },
): Promise<StockMovementRecord> {
  const product = await lockActiveProduct(client, input.businessId, input.productId);
  validateBaseUnitQuantity(input.targetQuantity, product.baseUnitAllowsDecimals, "Corrected quantity");
  const balance = await currentBalance(client, input.businessId, input.branchId, input.productId);
  const previousQuantity = balance?.quantity ?? 0;
  const averageUnitCost = previousQuantity === 0
    ? product.purchasePrice
    : balance?.averageUnitCost ?? product.purchasePrice;
  if (input.targetQuantity === previousQuantity) {
    throw new InventoryRuleError(
      400,
      "unchanged_stock_quantity",
      "Corrected quantity must differ from the current stock.",
    );
  }

  const quantityDelta = input.targetQuantity - previousQuantity;
  const cost = quantityDelta > 0
    ? { unitCost: averageUnitCost, totalCost: stockValue(quantityDelta, averageUnitCost) }
    : await consumeCostLayers(
        client,
        input.businessId,
        input.branchId,
        input.productId,
        Math.abs(quantityDelta),
      );
  await saveBalance(
    client,
    input.businessId,
    input.branchId,
    input.productId,
    input.targetQuantity,
    averageUnitCost,
  );
  const movement = await insertMovement(client, {
    businessId: input.businessId,
    branchId: input.branchId,
    productId: input.productId,
    productName: product.name,
    movementType: "stock_correction",
    quantityDelta,
    unitCost: cost.unitCost,
    totalCost: cost.totalCost,
    previousQuantity,
    newQuantity: input.targetQuantity,
    referenceType: "product",
    referenceId: input.productId,
    reason: input.reason,
    userId: input.userId,
  });
  if (quantityDelta > 0) {
    await addCostLayer(client, {
      businessId: input.businessId,
      branchId: input.branchId,
      productId: input.productId,
      sourceMovementId: movement.id,
      sourceType: "stock_correction",
      quantity: quantityDelta,
      unitCost: cost.unitCost,
    });
  }
  return movement;
}

export async function receiveStock(
  client: PoolClient,
  input: StockReceiptInput & {
    businessId: string;
    branchId: string;
    productId: string;
    userId: string;
  },
): Promise<StockMovementRecord> {
  const product = await lockActiveProduct(client, input.businessId, input.productId);
  validateBaseUnitQuantity(input.quantity, product.baseUnitAllowsDecimals, "Received quantity");
  const balance = await currentBalance(client, input.businessId, input.branchId, input.productId);
  const previousQuantity = balance?.quantity ?? 0;
  const newQuantity = toSafeInteger(
    BigInt(previousQuantity) + BigInt(input.quantity),
    "Received stock quantity",
  );
  const averageUnitCost = previousQuantity === 0
    ? input.receivedUnitCost
    : toSafeInteger(
        (
          BigInt(previousQuantity) * BigInt(balance?.averageUnitCost ?? product.purchasePrice) +
          BigInt(input.quantity) * BigInt(input.receivedUnitCost) +
          BigInt(newQuantity) / 2n
        ) / BigInt(newQuantity),
        "Average unit cost",
      );
  const totalCost = stockValue(input.quantity, input.receivedUnitCost);

  await saveBalance(
    client,
    input.businessId,
    input.branchId,
    input.productId,
    newQuantity,
    averageUnitCost,
  );
  const movement = await insertMovement(client, {
    businessId: input.businessId,
    branchId: input.branchId,
    productId: input.productId,
    productName: product.name,
    movementType: "purchase_received",
    quantityDelta: input.quantity,
    unitCost: input.receivedUnitCost,
    totalCost,
    previousQuantity,
    newQuantity,
    referenceType: "supplier_document",
    referenceId: input.receiptReference,
    reason: input.reason,
    userId: input.userId,
  });
  await addCostLayer(client, {
    businessId: input.businessId,
    branchId: input.branchId,
    productId: input.productId,
    sourceMovementId: movement.id,
    sourceType: "purchase_received",
    quantity: input.quantity,
    unitCost: input.receivedUnitCost,
  });
  return movement;
}
