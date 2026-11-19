import "server-only";

import type { Pool, PoolClient } from "pg";
import type { SalesHistoryQuery } from "@/lib/server/schemas/sales";

export type SalesExecutor = Pool | PoolClient;

export interface SaleHistoryItemRecord {
  productName: string;
  sku: string;
  quantity: number;
  unitName: string;
  unitPrice: number;
  lineTotal: number;
}

export interface SaleHistoryPaymentRecord {
  paymentMethod: string;
  amount: number;
}

export interface SaleHistoryEntryRecord {
  id: string;
  transactionNumber: string;
  status: "completed" | "cancelled";
  customerName: string | null;
  soldBy: string | null;
  subtotal: number;
  discount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  itemQuantity: number;
  createdAt: Date;
  items: SaleHistoryItemRecord[];
  payments: SaleHistoryPaymentRecord[];
}

export interface SalesHistoryPageRecord {
  items: SaleHistoryEntryRecord[];
  totalCount: number;
  completedSalesTotal: number;
  collectedAtSaleTotal: number;
}

function safeInteger(value: string, field: string, allowNegative = false): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (!allowNegative && parsed < 0)) {
    throw new Error(`The stored ${field} exceeds the browser's safe integer range.`);
  }
  return parsed;
}

export async function listSalesHistory(
  executor: SalesExecutor,
  businessId: string,
  branchId: string,
  query: SalesHistoryQuery,
): Promise<SalesHistoryPageRecord> {
  const search = query.search?.trim() || null;
  const pattern = search
    ? `%${search.replace(/[!%_]/g, (character) => `!${character}`)}%`
    : null;
  const where = `
    s.business_id = $1
    AND s.branch_id = $2
    AND ($3::text IS NULL OR
      s.transaction_number ILIKE $3 ESCAPE '!' OR
      COALESCE(c.name, '') ILIKE $3 ESCAPE '!' OR
      EXISTS (
        SELECT 1 FROM sale_items si
        WHERE si.business_id = s.business_id AND si.sale_id = s.id
          AND (si.product_name ILIKE $3 ESCAPE '!' OR si.sku ILIKE $3 ESCAPE '!')
      ))
    AND ($4::text IS NULL OR s.created_at::date >= $4::date)
    AND ($5::text IS NULL OR s.created_at::date <= $5::date)
  `;
  const values = [businessId, branchId, pattern, query.fromDate ?? null, query.toDate ?? null];

  const count = await executor.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id AND c.business_id = s.business_id
     WHERE ${where}`,
    values,
  );
  const totals = await executor.query<{
    completedSales: string;
    collected: string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.total ELSE 0 END), 0)::text AS "completedSales",
       COALESCE(SUM(CASE WHEN s.status = 'completed' THEN
         (SELECT COALESCE(SUM(sp.amount), 0)
          FROM sale_payments sp
          WHERE sp.business_id = s.business_id AND sp.sale_id = s.id)
         ELSE 0 END), 0)::text AS "collected"
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id AND c.business_id = s.business_id
     WHERE ${where}`,
    values,
  );

  const sales = await executor.query<{
    id: string;
    transactionNumber: string;
    status: "completed" | "cancelled";
    customerName: string | null;
    soldBy: string | null;
    subtotal: string;
    discount: string;
    total: string;
    amountPaid: string;
    createdAt: Date;
  }>(
    `SELECT s.id, s.transaction_number AS "transactionNumber", s.status,
            c.name AS "customerName", u.full_name AS "soldBy",
            s.subtotal::text AS subtotal, s.discount::text AS discount,
            s.total::text AS total,
            COALESCE((
              SELECT SUM(sp.amount)
              FROM sale_payments sp
              WHERE sp.business_id = s.business_id AND sp.sale_id = s.id
            ), 0)::text AS "amountPaid",
            s.created_at AS "createdAt"
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id AND c.business_id = s.business_id
     LEFT JOIN users u ON u.id = s.sold_by AND u.business_id = s.business_id
     WHERE ${where}
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT $6 OFFSET $7`,
    [...values, query.limit, query.offset],
  );

  const items: SaleHistoryEntryRecord[] = [];
  for (const sale of sales.rows) {
    const saleItems = await executor.query<{
      productName: string;
      sku: string;
      quantity: string;
      unitName: string;
      unitPrice: string;
      lineTotal: string;
    }>(
      `SELECT product_name AS "productName", sku, quantity::text AS quantity,
              unit_name AS "unitName", unit_price::text AS "unitPrice",
              line_total::text AS "lineTotal"
       FROM sale_items
       WHERE business_id = $1 AND sale_id = $2
       ORDER BY id`,
      [businessId, sale.id],
    );
    const payments = await executor.query<{ paymentMethod: string; amount: string }>(
      `SELECT payment_method AS "paymentMethod", amount::text AS amount
       FROM sale_payments
       WHERE business_id = $1 AND sale_id = $2
       ORDER BY created_at, id`,
      [businessId, sale.id],
    );
    const total = safeInteger(sale.total, "sale total");
    const amountPaid = safeInteger(sale.amountPaid, "sale payments");
    if (amountPaid > total) {
      throw new Error(`Recorded sale payments exceed the total for ${sale.transactionNumber}.`);
    }
    items.push({
      id: sale.id,
      transactionNumber: sale.transactionNumber,
      status: sale.status,
      customerName: sale.customerName,
      soldBy: sale.soldBy,
      subtotal: safeInteger(sale.subtotal, "sale subtotal"),
      discount: safeInteger(sale.discount, "sale discount"),
      total,
      amountPaid,
      balanceDue: total - amountPaid,
      itemQuantity: saleItems.rows.reduce(
        (sum, row) => sum + safeInteger(row.quantity, "sale item quantity"),
        0,
      ),
      createdAt: sale.createdAt,
      items: saleItems.rows.map((row) => ({
        productName: row.productName,
        sku: row.sku,
        quantity: safeInteger(row.quantity, "sale item quantity"),
        unitName: row.unitName,
        unitPrice: safeInteger(row.unitPrice, "sale unit price"),
        lineTotal: safeInteger(row.lineTotal, "sale line total"),
      })),
      payments: payments.rows.map((row) => ({
        paymentMethod: row.paymentMethod,
        amount: safeInteger(row.amount, "sale payment"),
      })),
    });
  }

  return {
    items,
    totalCount: safeInteger(count.rows[0]?.count ?? "0", "sales history count"),
    completedSalesTotal: safeInteger(totals.rows[0]?.completedSales ?? "0", "completed sales total"),
    collectedAtSaleTotal: safeInteger(totals.rows[0]?.collected ?? "0", "collected sales total"),
  };
}
