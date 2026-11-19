import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required.");
process.env.DATABASE_URL = testDatabaseUrl;
process.env.WEB_BASE_URL = "http://localhost:3000";

const [
  { getDatabasePool },
  { withTransaction },
  { createBusiness },
  { createBranch },
  { createAdminUser, createManagerUser },
  { seedDefaultManagerPermissions },
  { createAuthSession },
  { createOpaqueToken, hashOpaqueToken, authSessionCookieName },
  { GET: getSalesHistory },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/repositories/branches.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/repositories/manager-permissions.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/app/api/sales/route.ts"),
]);

test("sales history is branch-scoped, searchable, paginated and snapshot-accurate", async () => {
  const pool = getDatabasePool();
  const unique = String(Date.now());
  const businessIds = [];
  const sessionHashes = [];
  const cookieName = authSessionCookieName();
  const originHeaders = { Origin: "http://localhost:3000", "Content-Type": "application/json" };
  let branchId;
  let otherBranchId;
  let adminToken;
  let managerToken;

  function request(path, token) {
    return new NextRequest(`http://localhost:3000${path}`, {
      headers: {
        Cookie: `${cookieName}=${token}`,
        ...originHeaders,
      },
    });
  }

  try {
    await withTransaction(async (client) => {
      const business = await createBusiness(client, { name: `Sales history ${unique}` });
      businessIds.push(business.id);
      const admin = await createAdminUser(client, {
        businessId: business.id,
        username: `sales.admin.${unique.slice(-8)}`,
        fullName: "Sales Admin",
        email: `sales-admin-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [admin.id]);
      const branch = await createBranch(client, business.id, { name: "Sales Main" }, true);
      const otherBranch = await createBranch(client, business.id, { name: "Sales Other" }, true);
      branchId = branch.id;
      otherBranchId = otherBranch.id;
      const accounts = await client.query(
        `INSERT INTO cash_accounts (business_id, branch_id, account_type, name)
         VALUES
           ($1, $2, 'cash_drawer', 'Sales history cash'),
           ($1, $2, 'mtn_wallet', 'Sales history MTN')
         RETURNING id, account_type AS "accountType"`,
        [business.id, branchId],
      );
      const cashAccountId = accounts.rows.find((account) => account.accountType === "cash_drawer").id;
      const mtnAccountId = accounts.rows.find((account) => account.accountType === "mtn_wallet").id;
      await client.query(
        `INSERT INTO cash_account_openings
           (business_id, account_id, opening_amount, entered_by_user_id, authorized_by_user_id)
         VALUES ($1, $2, 100000, $3, $3), ($1, $4, 100000, $3, $3)`,
        [business.id, cashAccountId, admin.id, mtnAccountId],
      );
      const manager = await createManagerUser(client, {
        businessId: business.id,
        branchId: branch.id,
        username: `sales.manager.${unique.slice(-8)}`,
        fullName: "Sales Manager",
        passwordHash: "$argon2id$integration-test",
      });
      await seedDefaultManagerPermissions(client, business.id);
      await client.query(
        `UPDATE business_manager_permissions
         SET enabled = TRUE
         WHERE business_id = $1 AND permission_id IN ('sales.read','pos.use')`,
        [business.id],
      );

      const customer = await client.query(
        `INSERT INTO customers (business_id, name, credit_limit)
         VALUES ($1, $2, 50000) RETURNING id`,
        [business.id, "History Customer"],
      );
      const customerId = customer.rows[0].id;
      const unit = await client.query(`SELECT id FROM units WHERE code = 'pc'`);
      const product = await client.query(
        `INSERT INTO products
           (business_id, name, sku, base_unit_id, purchase_price, selling_price)
         VALUES ($1, $2, $3, $4, 8000, 12000)
         RETURNING id`,
        [business.id, "History Cement", `HIST-${unique.slice(-8)}`, unit.rows[0].id],
      );
      const productId = product.rows[0].id;

      const sale = await client.query(
        `INSERT INTO sales
           (business_id, branch_id, transaction_number, subtotal, discount, total,
            sold_by, customer_id)
         VALUES ($1, $2, $3, 24000, 0, 24000, $4, $5)
         RETURNING id`,
        [business.id, branchId, `SALE-HIST-${unique}`, admin.id, customerId],
      );
      const saleId = sale.rows[0].id;
      await client.query(
        `INSERT INTO sale_items
           (business_id, sale_id, product_id, product_name, sku, quantity, unit_name,
            listed_unit_price, unit_price, line_total, unit_cost, total_cost)
         VALUES ($1, $2, $3, 'History Cement', $4, 2000, 'Piece',
                 12000, 12000, 24000, 8000, 16000)`,
        [business.id, saleId, productId, `HIST-${unique.slice(-8)}`],
      );
      for (const [paymentMethod, amount, paymentAccountId] of [
        ["cash", 10000, cashAccountId],
        ["mtn_mobile_money", 14000, mtnAccountId],
      ]) {
        const payment = await client.query(
          `INSERT INTO sale_payments
             (business_id, sale_id, payment_method, amount, cash_account_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [business.id, saleId, paymentMethod, amount, paymentAccountId],
        );
        await client.query(
          `INSERT INTO cash_movements
             (business_id, account_id, movement_type, direction, amount, source_type,
              source_id, recorded_at, description)
           SELECT $1, $2, 'sale_collection', 'in', $3, 'sale_payment',
                  p.id, p.created_at, 'Sales history fixture'
           FROM sale_payments p
           WHERE p.business_id = $1 AND p.id = $4`,
          [business.id, paymentAccountId, amount, payment.rows[0].id],
        );
      }

      const otherSale = await client.query(
        `INSERT INTO sales
           (business_id, branch_id, transaction_number, subtotal, total)
         VALUES ($1, $2, $3, 12000, 12000)
         RETURNING id`,
        [business.id, otherBranchId, `SALE-OTHER-${unique}`],
      );
      await client.query(
        `INSERT INTO sale_items
           (business_id, sale_id, product_id, product_name, sku, quantity, unit_name,
            listed_unit_price, unit_price, line_total, unit_cost, total_cost)
         VALUES ($1, $2, $3, 'Other Product', 'OTHER', 1000, 'Piece',
                 12000, 12000, 12000, 8000, 8000)`,
        [business.id, otherSale.rows[0].id, productId],
      );

      for (const [userId, token] of [
        [admin.id, createOpaqueToken()],
        [manager.id, createOpaqueToken()],
      ]) {
        const tokenHash = hashOpaqueToken(token);
        sessionHashes.push(tokenHash);
        await createAuthSession(client, {
          businessId: business.id,
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        });
        if (userId === admin.id) adminToken = token;
        if (userId === manager.id) managerToken = token;
      }
    });

    const today = new Date().toISOString().slice(0, 10);
    const main = await getSalesHistory(request(
      `/api/sales?branchId=${branchId}&search=history&fromDate=${today}&toDate=${today}&offset=0&limit=30`,
      managerToken,
    ));
    assert.equal(main.status, 200);
    const mainPage = await main.json();
    assert.equal(mainPage.total_count, 1);
    assert.equal(mainPage.completed_sales_total, 24000);
    assert.equal(mainPage.collected_at_sale_total, 24000);
    assert.equal(mainPage.items[0].customer_name, "History Customer");
    assert.equal(mainPage.items[0].item_quantity, 2000);
    assert.equal(mainPage.items[0].payments.length, 2);
    assert.equal(mainPage.items[0].items[0].unit_price, 12000);

    const other = await getSalesHistory(request(
      `/api/sales?branchId=${otherBranchId}&offset=0&limit=30`,
      managerToken,
    ));
    assert.equal(other.status, 403);

    const invalidDate = await getSalesHistory(request(
      `/api/sales?branchId=${branchId}&fromDate=2026-12-31&toDate=2026-01-01`,
      adminToken,
    ));
    assert.equal(invalidDate.status, 400);
  } finally {
    if (sessionHashes.length) {
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = ANY($1::bytea[])", [sessionHashes]);
    }
    for (const businessId of businessIds) {
      await pool.query("DELETE FROM audit_logs WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_movements WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM sale_payments WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM customer_debts WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM sale_items WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM sales WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_account_openings WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_accounts WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM customers WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM products WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM business_manager_permissions WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM branches WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
    await pool.end();
  }
});
