import "server-only";

import type { Pool, PoolClient } from "pg";

import type {
  PurchaseCreateInput,
  PurchaseHistoryQuery,
  PurchasePaymentInput,
  PurchaseReceiptInput,
} from "@/lib/server/schemas/purchases";
import type { StockReceiptInput } from "@/lib/server/schemas/inventory";
import { receiveStock } from "./inventory";
import {
  accountBalance,
  listOpenedCashAccountsForBranch,
  lockOpenedCashAccountForPayment,
} from "./ledger";

export type PurchaseExecutor = Pool | PoolClient;

export interface PurchaseProductRecord {
  id: string;
  name: string;
  sku: string;
  baseUnitName: string;
  purchasePrice: number;
  baseUnitAllowsDecimals: boolean;
}

export interface PurchaseItemRecord {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unitName: string;
  orderedQuantity: number;
  receivedQuantity: number;
  unitCost: number;
  lineTotal: number;
  baseUnitAllowsDecimals: boolean;
}

export interface PurchaseDeliveryRecord {
  id: string;
  deliveryReference: string | null;
  notes: string | null;
  totalCost: number;
  createdAt: Date;
  items: Array<{
    productName: string;
    quantity: number;
    unitName: string;
    totalCost: number;
  }>;
}

export type SupplierPaymentMethod = "cash" | "mtn_mobile_money" | "airtel_money" | "bank_transfer";

export interface PurchasePaymentRecord {
  id: string;
  paymentMethod: SupplierPaymentMethod;
  amount: number;
  createdAt: Date;
}

export interface PurchaseRecord {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  status: "pending" | "partially_received" | "received";
  subtotal: number;
  amountPaid: number;
  balanceDue: number;
  duplicateAuthorized: boolean;
  duplicateOfPurchaseId: string | null;
  createdAt: Date;
  items: PurchaseItemRecord[];
  deliveries: PurchaseDeliveryRecord[];
  payments: PurchasePaymentRecord[];
}

export interface PurchasePaymentOptionRecord {
  id: string;
  accountType: "cash_drawer" | "bank" | "mtn_wallet" | "airtel_wallet" | "other";
  name: string;
  availableBalance: number;
}

export interface PurchaseHistoryRecord {
  items: PurchaseRecord[];
  totalCount: number;
  purchaseTotal: number;
  paidTotal: number;
  balanceDueTotal: number;
}

export class PurchaseRuleError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "PurchaseRuleError";
  }
}

function safeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`The stored ${field} exceeds the browser's safe integer range.`);
  }
  return parsed;
}

export async function listPurchaseProducts(
  executor: PurchaseExecutor,
  businessId: string,
): Promise<PurchaseProductRecord[]> {
  const result = await executor.query<{
    id: string;
    name: string;
    sku: string;
    baseUnitName: string;
    purchasePrice: string;
    baseUnitAllowsDecimals: boolean;
  }>(
    `SELECT p.id, p.name, p.sku, u.name AS "baseUnitName",
            p.purchase_price::text AS "purchasePrice",
            u.decimals_ok AS "baseUnitAllowsDecimals"
     FROM products p
     JOIN units u ON u.id = p.base_unit_id
     WHERE p.business_id = $1 AND p.is_active = TRUE
     ORDER BY lower(p.name), p.id
     LIMIT 500`,
    [businessId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    sku: row.sku,
    baseUnitName: row.baseUnitName,
    purchasePrice: safeInteger(row.purchasePrice, "purchase price"),
    baseUnitAllowsDecimals: row.baseUnitAllowsDecimals,
  }));
}

export async function lockPurchaseBranch(
  client: PoolClient,
  businessId: string,
  branchId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT id FROM branches
     WHERE business_id = $1 AND id = $2 AND is_active = TRUE
     FOR SHARE`,
    [businessId, branchId],
  );
  if (result.rowCount !== 1) {
    throw new PurchaseRuleError(404, "branch_not_found", "The selected branch is unavailable.");
  }
}

export async function createPurchase(
  client: PoolClient,
  businessId: string,
  branchId: string,
  input: PurchaseCreateInput,
): Promise<PurchaseRecord> {
  const supplier = await client.query<{ id: string }>(
    `SELECT id FROM suppliers
     WHERE business_id = $1 AND id = $2 AND branch_id = $3 AND is_active = TRUE
     FOR SHARE`,
    [businessId, input.supplierId, branchId],
  );
  if (supplier.rowCount !== 1) {
    throw new PurchaseRuleError(404, "supplier_not_found", "The selected supplier is unavailable.");
  }

  const duplicate = await client.query<{ id: string }>(
    `SELECT id FROM purchases
     WHERE business_id = $1 AND branch_id = $2 AND supplier_id = $3
       AND upper(supplier_invoice_number) = upper($4)
     ORDER BY created_at, id
     LIMIT 1`,
    [businessId, branchId, input.supplierId, input.supplierInvoiceNumber],
  );
  const duplicateFound = (duplicate.rowCount ?? 0) > 0;
  if (duplicateFound && !input.authorizeDuplicate) {
    throw new PurchaseRuleError(
      409,
      "duplicate_purchase_invoice",
      "This supplier already has a purchase with that invoice number. Confirm duplicate authorization.",
    );
  }

  let subtotal = 0;
  const lines: Array<{
    productId: string;
    orderedQuantity: number;
    unitCost: number;
    productName: string;
    sku: string;
    unitName: string;
    lineTotal: number;
  }> = [];

  const seen = new Set<string>();
  for (const inputLine of input.items) {
    if (seen.has(inputLine.productId)) {
      throw new PurchaseRuleError(400, "duplicate_purchase_line", "A product can only appear once on a purchase.");
    }
    seen.add(inputLine.productId);
    const product = await client.query<{
      name: string;
      sku: string;
      unitName: string;
      decimalsOk: boolean;
    }>(
      `SELECT p.name, p.sku, u.name AS "unitName", u.decimals_ok AS "decimalsOk"
       FROM products p
       JOIN units u ON u.id = p.base_unit_id
       WHERE p.business_id = $1 AND p.id = $2 AND p.is_active = TRUE
       FOR SHARE`,
      [businessId, inputLine.productId],
    );
    if (product.rowCount !== 1) {
      throw new PurchaseRuleError(404, "product_not_found", "A selected product is unavailable.");
    }
    const row = product.rows[0];
    if (!row.decimalsOk && inputLine.orderedQuantity % 1000 !== 0) {
      throw new PurchaseRuleError(400, "whole_units_required", `${row.name} only allows whole base units.`);
    }
    const lineTotal = Number((BigInt(inputLine.orderedQuantity) * BigInt(inputLine.unitCost) + 500n) / 1000n);
    if (!Number.isSafeInteger(lineTotal)) {
      throw new PurchaseRuleError(400, "invalid_purchase_total", "The purchase total is too large.");
    }
    subtotal = subtotal + lineTotal;
    if (!Number.isSafeInteger(subtotal)) {
      throw new PurchaseRuleError(400, "invalid_purchase_total", "The purchase total is too large.");
    }
    lines.push({
      productId: inputLine.productId,
      orderedQuantity: inputLine.orderedQuantity,
      unitCost: inputLine.unitCost,
      productName: row.name,
      sku: row.sku,
      unitName: row.unitName,
      lineTotal,
    });
  }

  const purchase = await client.query<{ id: string }>(
    `INSERT INTO purchases
       (business_id, branch_id, supplier_id, supplier_invoice_number, subtotal,
        duplicate_authorized, duplicate_of_purchase_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      businessId,
      branchId,
      input.supplierId,
      input.supplierInvoiceNumber,
      subtotal,
      duplicateFound,
      duplicate.rows[0]?.id ?? null,
    ],
  );
  const purchaseId = purchase.rows[0]?.id;
  if (!purchaseId) {
    throw new Error("PostgreSQL did not return the created purchase.");
  }

  for (const line of lines) {
    await client.query(
      `INSERT INTO purchase_items
         (business_id, purchase_id, product_id, product_name, sku, unit_name,
          ordered_quantity, unit_cost, line_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        businessId,
        purchaseId,
        line.productId,
        line.productName,
        line.sku,
        line.unitName,
        line.orderedQuantity,
        line.unitCost,
        line.lineTotal,
      ],
    );
  }
  const created = await findPurchase(client, businessId, branchId, purchaseId);
  if (!created) {
    throw new Error("PostgreSQL did not return the created purchase record.");
  }
  return created;
}

export async function findPurchase(
  executor: PurchaseExecutor,
  businessId: string,
  branchId: string,
  purchaseId: string,
): Promise<PurchaseRecord | null> {
  const purchase = await executor.query<{
    id: string;
    supplierId: string;
    supplierName: string;
    supplierInvoiceNumber: string;
    status: PurchaseRecord["status"];
    subtotal: string;
    duplicateAuthorized: boolean;
    duplicateOfPurchaseId: string | null;
    createdAt: Date;
  }>(
    `SELECT p.id, p.supplier_id AS "supplierId", s.name AS "supplierName",
            p.supplier_invoice_number AS "supplierInvoiceNumber", p.status,
            p.subtotal::text AS subtotal, p.duplicate_authorized AS "duplicateAuthorized",
            p.duplicate_of_purchase_id AS "duplicateOfPurchaseId", p.created_at AS "createdAt"
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id AND s.business_id = p.business_id
     WHERE p.business_id = $1 AND p.branch_id = $2 AND p.id = $3`,
    [businessId, branchId, purchaseId],
  );
  if (purchase.rowCount !== 1) return null;
  const head = purchase.rows[0];

  const itemResult = await executor.query<{
    id: string;
    productId: string;
    productName: string;
    sku: string;
    unitName: string;
    orderedQuantity: string;
    receivedQuantity: string;
    unitCost: string;
    lineTotal: string;
    decimalsOk: boolean;
  }>(
    `SELECT pi.id, pi.product_id AS "productId", pi.product_name AS "productName",
            pi.sku, pi.unit_name AS "unitName", pi.ordered_quantity::text AS "orderedQuantity",
            pi.received_quantity::text AS "receivedQuantity", pi.unit_cost::text AS "unitCost",
            pi.line_total::text AS "lineTotal", u.decimals_ok AS "decimalsOk"
     FROM purchase_items pi
     JOIN products p ON p.id = pi.product_id AND p.business_id = pi.business_id
     JOIN units u ON u.id = p.base_unit_id
     WHERE pi.business_id = $1 AND pi.purchase_id = $2
     ORDER BY lower(pi.product_name), pi.id`,
    [businessId, purchaseId],
  );

  const receiptResult = await executor.query<{
    id: string;
    deliveryReference: string | null;
    notes: string | null;
    createdAt: Date;
  }>(
    `SELECT id, delivery_reference AS "deliveryReference", notes,
            created_at AS "createdAt"
     FROM purchase_receipts
     WHERE business_id = $1 AND branch_id = $2 AND purchase_id = $3
     ORDER BY created_at DESC, id DESC`,
    [businessId, branchId, purchaseId],
  );

  const deliveries: PurchaseDeliveryRecord[] = [];
  for (const receipt of receiptResult.rows) {
    const receiptItems = await executor.query<{
      productName: string;
      quantity: string;
      unitName: string;
      totalCost: string;
    }>(
      `SELECT pi.product_name AS "productName", pri.quantity::text AS quantity,
              pi.unit_name AS "unitName", pri.total_cost::text AS "totalCost"
       FROM purchase_receipt_items pri
       JOIN purchase_items pi ON pi.id = pri.purchase_item_id
       WHERE pri.business_id = $1 AND pri.receipt_id = $2
       ORDER BY lower(pi.product_name)`,
      [businessId, receipt.id],
    );
    const items = receiptItems.rows.map((item) => ({
      productName: item.productName,
      quantity: safeInteger(item.quantity, "received quantity"),
      unitName: item.unitName,
      totalCost: safeInteger(item.totalCost, "receipt cost"),
    }));
    deliveries.push({
      id: receipt.id,
      deliveryReference: receipt.deliveryReference,
      notes: receipt.notes,
      totalCost: items.reduce((sum, item) => sum + item.totalCost, 0),
      createdAt: receipt.createdAt,
      items,
    });
  }

  const paymentResult = await executor.query<{
    id: string;
    paymentMethod: SupplierPaymentMethod;
    amount: string;
    createdAt: Date;
  }>(
    `SELECT id, payment_method AS "paymentMethod", amount::text AS amount,
            created_at AS "createdAt"
     FROM purchase_payments
     WHERE business_id = $1 AND purchase_id = $2
     ORDER BY created_at DESC, id`,
    [businessId, purchaseId],
  );
  const payments = paymentResult.rows.map((payment) => ({
    id: payment.id,
    paymentMethod: payment.paymentMethod,
    amount: safeInteger(payment.amount, "supplier payment"),
    createdAt: payment.createdAt,
  }));
  const amountPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (!Number.isSafeInteger(amountPaid) || amountPaid > safeInteger(head.subtotal, "purchase subtotal")) {
    throw new Error("Stored supplier payments exceed the supported purchase total.");
  }
  const subtotal = safeInteger(head.subtotal, "purchase subtotal");

  return {
    id: head.id,
    supplierId: head.supplierId,
    supplierName: head.supplierName,
    supplierInvoiceNumber: head.supplierInvoiceNumber,
    status: head.status,
    subtotal,
    amountPaid,
    balanceDue: subtotal - amountPaid,
    duplicateAuthorized: head.duplicateAuthorized,
    duplicateOfPurchaseId: head.duplicateOfPurchaseId,
    createdAt: head.createdAt,
    items: itemResult.rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productName: row.productName,
      sku: row.sku,
      unitName: row.unitName,
      orderedQuantity: safeInteger(row.orderedQuantity, "ordered quantity"),
      receivedQuantity: safeInteger(row.receivedQuantity, "received quantity"),
      unitCost: safeInteger(row.unitCost, "unit cost"),
      lineTotal: safeInteger(row.lineTotal, "line total"),
      baseUnitAllowsDecimals: row.decimalsOk,
    })),
    deliveries,
    payments,
  };
}

export async function listPurchases(
  executor: PurchaseExecutor,
  businessId: string,
  branchId: string,
): Promise<PurchaseRecord[]> {
  const result = await executor.query<{ id: string }>(
    `SELECT id FROM purchases
     WHERE business_id = $1 AND branch_id = $2
       AND (
         status <> 'received'
         OR COALESCE((
           SELECT SUM(pp.amount)
           FROM purchase_payments pp
           WHERE pp.business_id = purchases.business_id
             AND pp.purchase_id = purchases.id
         ), 0) < subtotal
       )
     ORDER BY created_at DESC, id
     LIMIT 200`,
    [businessId, branchId],
  );
  const purchases: PurchaseRecord[] = [];
  for (const row of result.rows) {
    const purchase = await findPurchase(executor, businessId, branchId, row.id);
    if (purchase) purchases.push(purchase);
  }
  return purchases;
}

export async function listPurchasePaymentOptions(
  executor: PurchaseExecutor,
  businessId: string,
  branchId: string,
): Promise<PurchasePaymentOptionRecord[]> {
  const options: PurchasePaymentOptionRecord[] = [];
  for (const account of await listOpenedCashAccountsForBranch(executor, businessId, branchId)) {
    const availableBalance = await accountBalance(executor, businessId, account.id);
    if (availableBalance === null) {
      throw new Error("An opened supplier-payment account has no opening balance.");
    }
    options.push({ ...account, availableBalance });
  }
  return options;
}

export async function listPurchaseHistory(
  executor: PurchaseExecutor,
  businessId: string,
  input: PurchaseHistoryQuery,
): Promise<PurchaseHistoryRecord> {
  const search = input.search?.trim() || null;
  const filter = `p.business_id = $1 AND p.branch_id = $2 AND p.status = 'received'
    AND COALESCE((
      SELECT SUM(pp.amount) FROM purchase_payments pp
      WHERE pp.business_id = p.business_id AND pp.purchase_id = p.id
    ), 0) >= p.subtotal
    AND ($3::text IS NULL OR
      strpos(lower(s.name), lower($3)) > 0 OR
      strpos(lower(p.supplier_invoice_number), lower($3)) > 0 OR
      EXISTS (
        SELECT 1 FROM purchase_items pi
        WHERE pi.business_id = p.business_id AND pi.purchase_id = p.id
          AND (strpos(lower(pi.product_name), lower($3)) > 0
            OR strpos(lower(pi.sku), lower($3)) > 0)
      ) OR
      EXISTS (
        SELECT 1 FROM purchase_receipts pr
        WHERE pr.business_id = p.business_id AND pr.purchase_id = p.id
          AND strpos(lower(COALESCE(pr.delivery_reference, '')), lower($3)) > 0
      )
    )
    AND ($4::date IS NULL OR p.created_at::date >= $4::date)
    AND ($5::date IS NULL OR p.created_at::date <= $5::date)`;
  const totalsResult = await executor.query<{
    totalCount: string;
    purchaseTotal: string;
    paidTotal: string;
  }>(
    `SELECT COUNT(*)::text AS "totalCount",
            COALESCE(SUM(p.subtotal), 0)::text AS "purchaseTotal",
            COALESCE(SUM((
              SELECT COALESCE(SUM(pp.amount), 0)
              FROM purchase_payments pp
              WHERE pp.business_id = p.business_id AND pp.purchase_id = p.id
            )), 0)::text AS "paidTotal"
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id AND s.business_id = p.business_id
     WHERE ${filter}`,
    [businessId, input.branchId, search, input.fromDate ?? null, input.toDate ?? null],
  );
  const totals = totalsResult.rows[0];
  if (!totals) throw new Error("PostgreSQL did not return purchase history totals.");
  const totalCount = safeInteger(totals.totalCount, "purchase history count");
  const purchaseTotal = safeInteger(totals.purchaseTotal, "purchase history total");
  const paidTotal = safeInteger(totals.paidTotal, "paid purchase history total");
  const balanceDueTotal = purchaseTotal - paidTotal;
  if (balanceDueTotal < 0) throw new Error("Supplier payments exceed purchase history totals.");

  const pageResult = await executor.query<{ id: string }>(
    `SELECT p.id
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id AND s.business_id = p.business_id
     WHERE ${filter}
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT $6 OFFSET $7`,
    [
      businessId,
      input.branchId,
      search,
      input.fromDate ?? null,
      input.toDate ?? null,
      input.limit,
      input.offset,
    ],
  );
  const items: PurchaseRecord[] = [];
  for (const row of pageResult.rows) {
    const purchase = await findPurchase(executor, businessId, input.branchId, row.id);
    if (purchase) items.push(purchase);
  }
  return { items, totalCount, purchaseTotal, paidTotal, balanceDueTotal };
}

export async function recordPurchasePayment(
  client: PoolClient,
  input: PurchasePaymentInput & {
    businessId: string;
    purchaseId: string;
    userId: string;
  },
): Promise<PurchaseRecord> {
  const purchaseResult = await client.query<{
    subtotal: string;
    supplierName: string;
    supplierInvoiceNumber: string;
  }>(
    `SELECT p.subtotal::text AS subtotal, s.name AS "supplierName",
            p.supplier_invoice_number AS "supplierInvoiceNumber"
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id AND s.business_id = p.business_id
     WHERE p.business_id = $1 AND p.branch_id = $2 AND p.id = $3
     FOR UPDATE OF p`,
    [input.businessId, input.branchId, input.purchaseId],
  );
  if (purchaseResult.rowCount !== 1) {
    throw new PurchaseRuleError(404, "purchase_not_found", "The purchase is unavailable to this branch.");
  }
  const purchase = purchaseResult.rows[0];
  const subtotal = safeInteger(purchase.subtotal, "purchase subtotal");
  const paidResult = await client.query<{ amountPaid: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS "amountPaid"
     FROM purchase_payments
     WHERE business_id = $1 AND purchase_id = $2`,
    [input.businessId, input.purchaseId],
  );
  const amountPaid = safeInteger(paidResult.rows[0].amountPaid, "supplier payment total");
  const balanceDue = subtotal - amountPaid;
  if (balanceDue < 0) {
    throw new PurchaseRuleError(400, "invalid_supplier_balance", "Supplier payments exceed the invoice total.");
  }
  if (input.amount > balanceDue) {
    throw new PurchaseRuleError(400, "payment_exceeds_balance", "Payment exceeds the outstanding supplier balance.");
  }

  await lockOpenedCashAccountForPayment(
    client,
    input.businessId,
    input.branchId,
    input.cashAccountId,
    input.paymentMethod,
  );
  const availableBalance = await accountBalance(client, input.businessId, input.cashAccountId);
  if (availableBalance === null) {
    throw new PurchaseRuleError(400, "cash_account_not_opened", "Set an authorized opening balance before using this account.");
  }
  if (input.amount > availableBalance) {
    throw new PurchaseRuleError(400, "insufficient_funds", "Payment exceeds the verified funds in the selected account.");
  }

  const timestampResult = await client.query<{ createdAt: Date }>("SELECT now() AS \"createdAt\"");
  const createdAt = timestampResult.rows[0]?.createdAt;
  if (!createdAt) throw new Error("PostgreSQL did not return the supplier payment timestamp.");
  const paymentResult = await client.query<{ id: string }>(
    `INSERT INTO purchase_payments
       (business_id, purchase_id, payment_method, amount, created_at, cash_account_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.businessId,
      input.purchaseId,
      input.paymentMethod,
      input.amount,
      createdAt,
      input.cashAccountId,
    ],
  );
  const paymentId = paymentResult.rows[0]?.id;
  if (!paymentId) throw new Error("PostgreSQL did not return the supplier payment.");
  await client.query(
    `INSERT INTO cash_movements
       (business_id, account_id, movement_type, direction, amount, source_type,
        source_id, recorded_at, responsible_user_id, description)
     VALUES ($1, $2, 'supplier_payment', 'out', $3, 'purchase_payment',
             $4, $5, $6, $7)`,
    [
      input.businessId,
      input.cashAccountId,
      input.amount,
      paymentId,
      createdAt,
      input.userId,
      `${purchase.supplierName} · ${purchase.supplierInvoiceNumber}`,
    ],
  );

  const updated = await findPurchase(
    client,
    input.businessId,
    input.branchId,
    input.purchaseId,
  );
  if (!updated) throw new Error("PostgreSQL did not return the updated purchase.");
  return updated;
}

export interface PurchaseReceiptRecord {
  id: string;
  purchaseId: string;
  status: "pending" | "partially_received" | "received";
  deliveryReference: string | null;
  totalCost: number;
  createdAt: Date;
}

export async function receivePurchase(
  client: PoolClient,
  input: PurchaseReceiptInput & {
    businessId: string;
    purchaseId: string;
    userId: string;
  },
): Promise<PurchaseReceiptRecord> {
  await lockPurchaseBranch(client, input.businessId, input.branchId);

  const purchase = await client.query<{
    supplierInvoiceNumber: string;
  }>(
    `SELECT supplier_invoice_number AS "supplierInvoiceNumber"
     FROM purchases
     WHERE business_id = $1 AND branch_id = $2 AND id = $3
     FOR SHARE`,
    [input.businessId, input.branchId, input.purchaseId],
  );
  if (purchase.rowCount !== 1) {
    throw new PurchaseRuleError(404, "purchase_not_found", "The purchase is unavailable to this branch.");
  }

  const seen = new Set<string>();
  for (const receiptItem of input.items) {
    if (seen.has(receiptItem.purchaseItemId)) {
      throw new PurchaseRuleError(400, "duplicate_receipt_line", "A purchase line can only appear once per delivery.");
    }
    seen.add(receiptItem.purchaseItemId);
  }

  const receipt = await client.query<{ id: string; createdAt: Date }>(
    `INSERT INTO purchase_receipts
       (business_id, branch_id, purchase_id, delivery_reference, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at AS "createdAt"`,
    [
      input.businessId,
      input.branchId,
      input.purchaseId,
      input.deliveryReference ?? null,
      input.notes ?? null,
    ],
  );
  const receiptId = receipt.rows[0]?.id;
  const createdAt = receipt.rows[0]?.createdAt;
  if (!receiptId || !createdAt) {
    throw new Error("PostgreSQL did not return the purchase receipt.");
  }

  let totalCost = 0;
  for (const receiptItem of input.items) {
    const line = await client.query<{
      productId: string;
      productName: string;
      orderedQuantity: string;
      receivedQuantity: string;
      unitCost: string;
      decimalsOk: boolean;
    }>(
      `SELECT pi.product_id AS "productId", pi.product_name AS "productName",
              pi.ordered_quantity::text AS "orderedQuantity",
              pi.received_quantity::text AS "receivedQuantity",
              pi.unit_cost::text AS "unitCost", u.decimals_ok AS "decimalsOk"
       FROM purchase_items pi
       JOIN products p ON p.id = pi.product_id AND p.business_id = pi.business_id
       JOIN units u ON u.id = p.base_unit_id
       WHERE pi.business_id = $1 AND pi.purchase_id = $2 AND pi.id = $3
       FOR SHARE`,
      [input.businessId, input.purchaseId, receiptItem.purchaseItemId],
    );
    if (line.rowCount !== 1) {
      throw new PurchaseRuleError(400, "invalid_purchase_line", "A selected line does not belong to this invoice.");
    }
    const row = line.rows[0];
    const ordered = Number(row.orderedQuantity);
    const received = Number(row.receivedQuantity);
    const unitCost = Number(row.unitCost);
    if (!row.decimalsOk && receiptItem.quantity % 1000 !== 0) {
      throw new PurchaseRuleError(400, "whole_units_required", `${row.productName} only allows whole base units.`);
    }
    const remaining = ordered - received;
    if (receiptItem.quantity > remaining) {
      throw new PurchaseRuleError(
        400,
        "quantity_exceeds_remaining",
        `Received quantity exceeds the ${remaining} remaining for ${row.productName}.`,
      );
    }
    const lineCost = Number((BigInt(receiptItem.quantity) * BigInt(unitCost) + 500n) / 1000n);
    if (!Number.isSafeInteger(lineCost)) {
      throw new PurchaseRuleError(400, "invalid_receipt_total", "The delivery total is too large.");
    }
    totalCost = totalCost + lineCost;
    if (!Number.isSafeInteger(totalCost)) {
      throw new PurchaseRuleError(400, "invalid_receipt_total", "The delivery total is too large.");
    }

    const stockReceipt: StockReceiptInput & {
      businessId: string;
      branchId: string;
      productId: string;
      userId: string;
    } = {
      branchId: input.branchId,
      quantity: receiptItem.quantity,
      receivedUnitCost: unitCost,
      receiptReference: purchase.rows[0].supplierInvoiceNumber,
      reason: input.notes ?? `Supplier invoice ${purchase.rows[0].supplierInvoiceNumber}`,
      newSellingPrice: null,
      businessId: input.businessId,
      productId: row.productId,
      userId: input.userId,
    };
    await receiveStock(client, stockReceipt);

    await client.query(
      `UPDATE purchase_items
       SET received_quantity = $1
       WHERE business_id = $2 AND purchase_id = $3 AND id = $4
         AND received_quantity = $5`,
      [received + receiptItem.quantity, input.businessId, input.purchaseId, receiptItem.purchaseItemId, received],
    );
    await client.query(
      `INSERT INTO purchase_receipt_items
         (business_id, receipt_id, purchase_item_id, quantity, unit_cost, total_cost)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.businessId,
        receiptId,
        receiptItem.purchaseItemId,
        receiptItem.quantity,
        unitCost,
        lineCost,
      ],
    );
  }

  const statusResult = await client.query<{ status: "received" | "partially_received" }>(
    `SELECT CASE
       WHEN COUNT(*) FILTER (WHERE received_quantity = ordered_quantity) = COUNT(*) THEN 'received'
       ELSE 'partially_received'
     END AS status
     FROM purchase_items
     WHERE business_id = $1 AND purchase_id = $2`,
    [input.businessId, input.purchaseId],
  );
  const status = statusResult.rows[0]?.status ?? "partially_received";
  await client.query(
    `UPDATE purchases SET status = $1, updated_at = now()
     WHERE business_id = $2 AND branch_id = $3 AND id = $4`,
    [status, input.businessId, input.branchId, input.purchaseId],
  );
  return {
    id: receiptId,
    purchaseId: input.purchaseId,
    status,
    deliveryReference: input.deliveryReference ?? null,
    totalCost,
    createdAt,
  };
}
