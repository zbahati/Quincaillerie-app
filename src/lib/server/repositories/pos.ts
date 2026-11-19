import "server-only";

import type { Pool, PoolClient } from "pg";

import type { PosCheckoutInput, PosListQuery } from "@/lib/server/schemas/pos";
import {
  consumeCostLayers,
  currentBalance,
  insertMovement,
  lockActiveProduct,
  saveBalance,
} from "./inventory";
import {
  listOpenedCashAccountsForBranch,
  lockOpenedCashAccountForPayment,
  type OpenedCashPaymentAccount,
} from "./ledger";

export type PosExecutor = Pool | PoolClient;

export class PosRuleError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "PosRuleError";
  }
}

export interface PosProductRecord {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  baseUnitName: string;
  sellingPrice: number;
  quantityOnHand: number;
  baseUnitAllowsDecimals: boolean;
}

export type PosPaymentAccountRecord = OpenedCashPaymentAccount;

export interface SaleReceiptRecord {
  id: string;
  transactionNumber: string;
  paymentMethod: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
  customerName: string | null;
  createdAt: Date;
  items: Array<{
    productName: string;
    sku: string;
    quantity: number;
    unitName: string;
    listedUnitPrice: number;
    unitPrice: number;
    lineTotal: number;
    priceChangeReason: string | null;
  }>;
  payments: Array<{ paymentMethod: string; amount: number }>;
}

function safeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`The stored ${field} exceeds the browser's safe integer range.`);
  }
  return parsed;
}

export async function listPosProducts(
  executor: PosExecutor,
  businessId: string,
  branchId: string,
  query: PosListQuery,
): Promise<{ items: PosProductRecord[]; totalCount: number }> {
  const search = query.search?.trim() || null;
  const pattern = search ? `%${search.replace(/[!%_]/g, (character) => `!${character}`)}%` : null;
  const count = await executor.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM products p
     JOIN units u ON u.id = p.base_unit_id
     WHERE p.business_id = $1 AND p.is_active = TRUE
       AND ($2::text IS NULL OR
         p.name ILIKE $2 ESCAPE '!' OR p.sku ILIKE $2 ESCAPE '!' OR
         COALESCE(p.barcode, '') ILIKE $2 ESCAPE '!')`,
    [businessId, pattern],
  );
  const result = await executor.query<{
    id: string;
    name: string;
    sku: string;
    barcode: string | null;
    baseUnitName: string;
    sellingPrice: string;
    quantityOnHand: string;
    baseUnitAllowsDecimals: boolean;
  }>(
    `SELECT p.id, p.name, p.sku, p.barcode, u.name AS "baseUnitName",
            p.selling_price::text AS "sellingPrice",
            COALESCE(b.quantity_on_hand, 0)::text AS "quantityOnHand",
            u.decimals_ok AS "baseUnitAllowsDecimals"
     FROM products p
     JOIN units u ON u.id = p.base_unit_id
     LEFT JOIN inventory_balances b
       ON b.business_id = p.business_id AND b.branch_id = $2 AND b.product_id = p.id
     WHERE p.business_id = $1 AND p.is_active = TRUE
       AND ($3::text IS NULL OR
         p.name ILIKE $3 ESCAPE '!' OR p.sku ILIKE $3 ESCAPE '!' OR
         COALESCE(p.barcode, '') ILIKE $3 ESCAPE '!')
     ORDER BY lower(p.name), p.id
     OFFSET $4 LIMIT $5`,
    [businessId, branchId, pattern, query.offset, query.limit],
  );
  return {
    totalCount: safeInteger(count.rows[0]?.count ?? "0", "POS product count"),
    items: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      baseUnitName: row.baseUnitName,
      sellingPrice: safeInteger(row.sellingPrice, "listed selling price"),
      quantityOnHand: safeInteger(row.quantityOnHand, "stock quantity"),
      baseUnitAllowsDecimals: row.baseUnitAllowsDecimals,
    })),
  };
}

export async function listPosPaymentAccounts(
  executor: PosExecutor,
  businessId: string,
  branchId: string,
): Promise<PosPaymentAccountRecord[]> {
  return listOpenedCashAccountsForBranch(executor, businessId, branchId);
}

export async function checkoutPosSale(
  client: PoolClient,
  input: PosCheckoutInput & {
    businessId: string;
    userId: string;
  },
): Promise<SaleReceiptRecord> {
  if (input.items.length === 0 || input.items.length > 100) {
    throw new PosRuleError(400, "invalid_cart", "A sale must contain between 1 and 100 products.");
  }
  if (input.payments.length === 0 || input.payments.length > 10) {
    throw new PosRuleError(400, "invalid_payments", "A sale must contain between 1 and 10 payment entries.");
  }

  const seen = new Set<string>();
  let subtotal = 0;
  const lines: Array<{
    productId: string;
    productName: string;
    sku: string;
    unitName: string;
    quantity: number;
    listedUnitPrice: number;
    unitPrice: number;
    lineTotal: number;
    priceChangeReason: string | null;
    unitCost: number;
    totalCost: number;
    previousQuantity: number;
    newQuantity: number;
    averageUnitCost: number;
  }> = [];

  for (const item of input.items) {
    if (seen.has(item.productId)) {
      throw new PosRuleError(400, "duplicate_cart_line", "A product can only appear once in a sale.");
    }
    seen.add(item.productId);
    const product = await lockActiveProduct(client, input.businessId, item.productId);
    if (!product) {
      throw new PosRuleError(404, "product_not_found", "A selected product is unavailable.");
    }
    if (!product.baseUnitAllowsDecimals && item.quantity % 1000 !== 0) {
      throw new PosRuleError(400, "whole_units_required", "This product only allows whole base units.");
    }
    const balance = await currentBalance(client, input.businessId, input.branchId, item.productId);
    const previousQuantity = balance?.quantity ?? 0;
    if (item.quantity > previousQuantity) {
      throw new PosRuleError(400, "insufficient_stock", `Not enough stock for ${product.name}.`);
    }
    const newQuantity = previousQuantity - item.quantity;
    const listedUnitPrice = product.sellingPrice;
    const unitPrice = item.sellingPrice ?? listedUnitPrice;
    if (unitPrice < 0) {
      throw new PosRuleError(400, "invalid_sale_price", "Sale price must not be negative.");
    }
    if (unitPrice !== listedUnitPrice && !item.priceChangeReason?.trim()) {
      throw new PosRuleError(400, "price_change_reason_required", `Provide a reason when changing the selling price for ${product.name}.`);
    }
    const lineTotal = Number((BigInt(item.quantity) * BigInt(unitPrice) + 500n) / 1000n);
    if (!Number.isSafeInteger(lineTotal)) {
      throw new PosRuleError(400, "invalid_sale_total", "Sale total exceeds the supported limit.");
    }
    subtotal = subtotal + lineTotal;
    if (!Number.isSafeInteger(subtotal)) {
      throw new PosRuleError(400, "invalid_sale_total", "Sale total exceeds the supported limit.");
    }
    const cost = await consumeCostLayers(
      client,
      input.businessId,
      input.branchId,
      item.productId,
      item.quantity,
    );
    let priceChangeReason = unitPrice !== listedUnitPrice ? item.priceChangeReason?.trim() ?? null : null;
    if (lineTotal < cost.totalCost) {
      if (!item.priceChangeReason?.trim()) {
        throw new PosRuleError(
          400,
          "below_cost_reason_required",
          `BELOW_FIFO_COST:${item.productId}: sale price for ${product.name} is below FIFO cost.`,
        );
      }
      priceChangeReason = item.priceChangeReason.trim();
    }
    lines.push({
      productId: item.productId,
      productName: product.name,
      sku: product.sku,
      unitName: product.baseUnitName,
      quantity: item.quantity,
      listedUnitPrice,
      unitPrice,
      lineTotal,
      priceChangeReason,
      unitCost: cost.unitCost,
      totalCost: cost.totalCost,
      previousQuantity,
      newQuantity,
      averageUnitCost: balance?.averageUnitCost ?? cost.unitCost,
    });
  }

  let amountPaid = 0;
  for (const payment of input.payments) {
    amountPaid = amountPaid + payment.amount;
    if (!Number.isSafeInteger(amountPaid)) {
      throw new PosRuleError(400, "invalid_payment_total", "Payment total exceeds the supported limit.");
    }
  }
  if (amountPaid > subtotal) {
    throw new PosRuleError(400, "payments_exceed_total", "Payments cannot exceed the sale total.");
  }
  const balanceDue = subtotal - amountPaid;
  let customerName: string | null = null;

  if (input.customerId) {
    const customer = await client.query<{ name: string; creditLimit: string }>(
      `SELECT name, credit_limit::text AS "creditLimit"
       FROM customers
       WHERE business_id = $1 AND id = $2 AND is_active = TRUE
       FOR SHARE`,
      [input.businessId, input.customerId],
    );
    if (customer.rowCount !== 1) {
      throw new PosRuleError(400, "customer_not_found", "Select an active customer from this business.");
    }
    customerName = customer.rows[0].name;
    if (balanceDue > 0) {
      const debt = await client.query<{ outstanding: string }>(
        `SELECT COALESCE(SUM(
                 s.total
                 - COALESCE((
                   SELECT SUM(sp.amount)
                   FROM sale_payments sp
                   WHERE sp.business_id = cd.business_id AND sp.sale_id = cd.sale_id
                 ), 0)
                 - COALESCE((
                   SELECT SUM(dp.amount)
                   FROM customer_debt_payments dp
                   WHERE dp.business_id = cd.business_id AND dp.debt_id = cd.id
                 ), 0)
               ), 0)::text AS outstanding
         FROM customer_debts cd
         JOIN sales s ON s.business_id = cd.business_id AND s.id = cd.sale_id
         WHERE cd.business_id = $1 AND cd.customer_id = $2`,
        [input.businessId, input.customerId],
      );
      const outstanding = Number(debt.rows[0]?.outstanding ?? "0");
      const creditLimit = Number(customer.rows[0].creditLimit);
      if (outstanding + balanceDue > creditLimit) {
        throw new PosRuleError(400, "customer_credit_limit_exceeded", "Customer credit limit exceeded.");
      }
    }
  } else if (balanceDue > 0) {
    throw new PosRuleError(400, "customer_required", "Select a customer to record the unpaid balance as credit.");
  }

  for (const payment of [...input.payments].sort((left, right) =>
    left.cashAccountId.localeCompare(right.cashAccountId))) {
    await lockOpenedCashAccountForPayment(
      client,
      input.businessId,
      input.branchId,
      payment.cashAccountId,
      payment.paymentMethod,
    );
  }

  const transactionNumber = `SALE-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const sale = await client.query<{ id: string; createdAt: Date }>(
    `INSERT INTO sales
       (business_id, branch_id, transaction_number, subtotal, discount, total, sold_by, customer_id)
     VALUES ($1, $2, $3, $4, 0, $4, $5, $6)
     RETURNING id, created_at AS "createdAt"`,
    [input.businessId, input.branchId, transactionNumber, subtotal, input.userId, input.customerId ?? null],
  );
  const saleId = sale.rows[0]?.id;
  const createdAt = sale.rows[0]?.createdAt;
  if (!saleId || !createdAt) {
    throw new Error("PostgreSQL did not return the sale.");
  }

  for (const line of lines) {
    await saveBalance(
      client,
      input.businessId,
      input.branchId,
      line.productId,
      line.newQuantity,
      line.averageUnitCost,
    );
    await client.query(
      `INSERT INTO sale_items
         (business_id, sale_id, product_id, product_name, sku, quantity, unit_name,
          listed_unit_price, unit_price, line_total, price_change_reason, unit_cost, total_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        input.businessId,
        saleId,
        line.productId,
        line.productName,
        line.sku,
        line.quantity,
        line.unitName,
        line.listedUnitPrice,
        line.unitPrice,
        line.lineTotal,
        line.priceChangeReason,
        line.unitCost,
        line.totalCost,
      ],
    );
    await insertMovement(client, {
      businessId: input.businessId,
      branchId: input.branchId,
      productId: line.productId,
      productName: line.productName,
      movementType: "sale",
      quantityDelta: -line.quantity,
      unitCost: line.unitCost,
      totalCost: line.totalCost,
      previousQuantity: line.previousQuantity,
      newQuantity: line.newQuantity,
      referenceType: "sale",
      referenceId: saleId,
      reason: "POS sale",
      userId: input.userId,
    });
  }

  for (const payment of input.payments) {
    const recordedPayment = await client.query<{ id: string }>(
      `INSERT INTO sale_payments
         (business_id, sale_id, payment_method, amount, created_at, cash_account_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.businessId,
        saleId,
        payment.paymentMethod,
        payment.amount,
        createdAt,
        payment.cashAccountId,
      ],
    );
    const paymentId = recordedPayment.rows[0]?.id;
    if (!paymentId) throw new Error("PostgreSQL did not return the sale payment.");
    await client.query(
      `INSERT INTO cash_movements
         (business_id, account_id, movement_type, direction, amount, source_type,
          source_id, recorded_at, responsible_user_id, description)
       VALUES ($1, $2, 'sale_collection', 'in', $3, 'sale_payment',
               $4, $5, $6, $7)`,
      [
        input.businessId,
        payment.cashAccountId,
        payment.amount,
        paymentId,
        createdAt,
        input.userId,
        `Sale ${transactionNumber}`,
      ],
    );
  }
  if (balanceDue > 0 && input.customerId) {
    await client.query(
      `INSERT INTO customer_debts
         (business_id, customer_id, sale_id, original_amount)
       VALUES ($1, $2, $3, $4)`,
      [input.businessId, input.customerId, saleId, balanceDue],
    );
  }

  return {
    id: saleId,
    transactionNumber,
    paymentMethod:
      input.payments.length === 1 ? input.payments[0].paymentMethod :
      amountPaid === 0 ? "credit" : "split",
    total: subtotal,
    amountPaid,
    balanceDue,
    customerName,
    createdAt,
    items: lines.map((line) => ({
      productName: line.productName,
      sku: line.sku,
      quantity: line.quantity,
      unitName: line.unitName,
      listedUnitPrice: line.listedUnitPrice,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      priceChangeReason: line.priceChangeReason,
    })),
    payments: input.payments.map((payment) => ({
      paymentMethod: payment.paymentMethod,
      amount: payment.amount,
    })),
  };
}
