import "server-only";

import type { PoolClient } from "pg";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";

import { requirePermission } from "../auth/authorization";
import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { recordAuditLog } from "../repositories/audit-logs";

const EXPORT_FORMAT = "quincaillerie-business-export";
const EXPORT_VERSION = 1;
const EXPORT_BATCH_SIZE = 128;
const EXCLUDED_DATA = [
  "password hashes",
  "authentication sessions",
  "email verification tokens",
  "password reset tokens",
  "authentication rate-limit state",
  "database restore is not supported by this export",
];

const EXPORT_TABLES = [
  { name: "businesses", query: "SELECT * FROM businesses WHERE id = $1 ORDER BY id" },
  { name: "branches", query: "SELECT * FROM branches WHERE business_id = $1 ORDER BY id" },
  {
    name: "users",
    query: `SELECT id, business_id, branch_id, role, username, full_name, email,
                   email_verified_at, is_active, last_login_at, created_at, updated_at
            FROM users WHERE business_id = $1 ORDER BY id`,
  },
  {
    name: "business_manager_permissions",
    query: "SELECT * FROM business_manager_permissions WHERE business_id = $1 ORDER BY permission_id",
  },
  { name: "categories", query: "SELECT * FROM categories WHERE business_id = $1 ORDER BY id" },
  { name: "brands", query: "SELECT * FROM brands WHERE business_id = $1 ORDER BY id" },
  {
    name: "units",
    query: "SELECT * FROM units WHERE business_id = $1 OR business_id IS NULL ORDER BY business_id NULLS FIRST, code, id",
  },
  { name: "products", query: "SELECT * FROM products WHERE business_id = $1 ORDER BY id" },
  {
    name: "product_units",
    query: `SELECT * FROM product_units
            WHERE product_id IN (SELECT id FROM products WHERE business_id = $1)
            ORDER BY product_id, sort_order, id`,
  },
  {
    name: "product_prices",
    query: `SELECT * FROM product_prices
            WHERE product_id IN (SELECT id FROM products WHERE business_id = $1)
            ORDER BY product_id, effective_from, id`,
  },
  {
    name: "inventory_balances",
    query: "SELECT * FROM inventory_balances WHERE business_id = $1 ORDER BY branch_id, product_id",
  },
  { name: "stock_movements", query: "SELECT * FROM stock_movements WHERE business_id = $1 ORDER BY id" },
  {
    name: "inventory_cost_layers",
    query: "SELECT * FROM inventory_cost_layers WHERE business_id = $1 ORDER BY id",
  },
  { name: "suppliers", query: "SELECT * FROM suppliers WHERE business_id = $1 ORDER BY id" },
  { name: "customers", query: "SELECT * FROM customers WHERE business_id = $1 ORDER BY id" },
  { name: "purchases", query: "SELECT * FROM purchases WHERE business_id = $1 ORDER BY id" },
  { name: "purchase_items", query: "SELECT * FROM purchase_items WHERE business_id = $1 ORDER BY id" },
  { name: "purchase_payments", query: "SELECT * FROM purchase_payments WHERE business_id = $1 ORDER BY id" },
  {
    name: "purchase_receipts",
    query: "SELECT * FROM purchase_receipts WHERE business_id = $1 ORDER BY id",
  },
  {
    name: "purchase_receipt_items",
    query: `SELECT pri.* FROM purchase_receipt_items pri
            JOIN purchase_receipts pr
              ON pr.business_id = pri.business_id AND pr.id = pri.receipt_id
            WHERE pr.business_id = $1
            ORDER BY pri.receipt_id, pri.id`,
  },
  { name: "sales", query: "SELECT * FROM sales WHERE business_id = $1 ORDER BY id" },
  { name: "sale_items", query: "SELECT * FROM sale_items WHERE business_id = $1 ORDER BY id" },
  { name: "sale_payments", query: "SELECT * FROM sale_payments WHERE business_id = $1 ORDER BY id" },
  { name: "customer_debts", query: "SELECT * FROM customer_debts WHERE business_id = $1 ORDER BY id" },
  {
    name: "customer_debt_payments",
    query: "SELECT * FROM customer_debt_payments WHERE business_id = $1 ORDER BY id",
  },
  { name: "cash_accounts", query: "SELECT * FROM cash_accounts WHERE business_id = $1 ORDER BY id" },
  {
    name: "cash_account_openings",
    query: "SELECT * FROM cash_account_openings WHERE business_id = $1 ORDER BY id",
  },
  { name: "cash_movements", query: "SELECT * FROM cash_movements WHERE business_id = $1 ORDER BY id" },
  { name: "expenses", query: "SELECT * FROM expenses WHERE business_id = $1 ORDER BY id" },
  { name: "cash_transfers", query: "SELECT * FROM cash_transfers WHERE business_id = $1 ORDER BY id" },
  { name: "audit_logs", query: "SELECT * FROM audit_logs WHERE business_id = $1 ORDER BY id" },
] as const;

async function* businessExportChunks(
  client: PoolClient,
  context: AuthenticatedContext,
  exportedAt: string,
): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  let transactionStarted = false;
  let committed = false;
  let releaseError: Error | undefined;

  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    transactionStarted = true;
    const business = await client.query(
      "SELECT id FROM businesses WHERE id = $1 AND is_active = TRUE",
      [context.businessId],
    );
    if (business.rowCount !== 1) {
      throw new AuthServiceError(404, "business_not_found", "The business is unavailable.");
    }

    await recordAuditLog(client, {
      businessId: context.businessId,
      userId: context.userId,
      action: "business.data_exported",
      entityType: "business",
      entityId: context.businessId,
      details: { format: EXPORT_FORMAT, version: EXPORT_VERSION },
    });

    yield encoder.encode(
      `{"format":${JSON.stringify(EXPORT_FORMAT)},"version":${EXPORT_VERSION},` +
      `"exportedAt":${JSON.stringify(exportedAt)},"scope":"business",` +
      `"businessId":${JSON.stringify(context.businessId)},` +
      `"excludes":${JSON.stringify(EXCLUDED_DATA)},"data":{`,
    );

    for (let index = 0; index < EXPORT_TABLES.length; index += 1) {
      const table = EXPORT_TABLES[index];
      await client.query({
        text: `DECLARE business_export_cursor NO SCROLL CURSOR FOR ${table.query}`,
        values: [context.businessId],
      });
      yield encoder.encode(`${index === 0 ? "" : ","}${JSON.stringify(table.name)}:[`);

      let firstRow = true;
      while (true) {
        const batch = await client.query(
          `FETCH FORWARD ${EXPORT_BATCH_SIZE} FROM business_export_cursor`,
        );
        if (batch.rowCount === 0) break;
        for (const row of batch.rows) {
          yield encoder.encode(`${firstRow ? "" : ","}${JSON.stringify(row)}`);
          firstRow = false;
        }
      }
      await client.query("CLOSE business_export_cursor");
      yield encoder.encode("]");
    }

    await client.query("COMMIT");
    transactionStarted = false;
    committed = true;
    yield encoder.encode("}}");
  } catch (cause) {
    releaseError = cause instanceof Error ? cause : new Error("Business export failed.");
    console.error(
      "Business data export failed.",
      cause instanceof Error ? cause.name : "UnknownError",
    );
    throw cause;
  } finally {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackCause) {
        const error = new AggregateError(
          [releaseError ?? new Error("Business export did not complete."), rollbackCause],
          "Business export failed and PostgreSQL could not roll back its snapshot.",
        );
        releaseError = error;
        throw error;
      }
    }
    client.release(committed ? undefined : releaseError);
  }
}

function exportFileName(businessName: string, exportedAt: string): string {
  const slug = businessName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "business";
  const timestamp = exportedAt.replace(/[:.]/g, "-");
  return `quincaillerie-${slug}-${timestamp}.json`;
}

export async function createBusinessDataExport(context: AuthenticatedContext) {
  if (context.role !== "admin") {
    throw new AuthServiceError(403, "forbidden", "Only a business Admin can export business data.");
  }
  requirePermission(context, "business.manage");

  const pool = getDatabasePool();
  const business = await pool.query<{ name: string }>(
    "SELECT name FROM businesses WHERE id = $1 AND is_active = TRUE",
    [context.businessId],
  );
  const businessName = business.rows[0]?.name;
  if (!businessName) {
    throw new AuthServiceError(404, "business_not_found", "The business is unavailable.");
  }

  const exportedAt = new Date().toISOString();
  const client = await pool.connect();
  const chunks = businessExportChunks(client, context, exportedAt);
  const iterator = chunks[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (cause) {
        controller.error(cause);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });

  return { fileName: exportFileName(businessName, exportedAt), body };
}
