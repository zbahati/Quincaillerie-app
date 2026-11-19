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
  { accountBalance },
  { GET: getPosPaymentAccounts },
  { GET: getPosProducts },
  { POST: checkoutPos },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/repositories/branches.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/repositories/manager-permissions.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/lib/server/repositories/ledger.ts"),
  import("../../src/app/api/pos/payment-options/route.ts"),
  import("../../src/app/api/pos/products/route.ts"),
  import("../../src/app/api/pos/checkout/route.ts"),
]);

test("POS enforces branch stock, split totals, FIFO costs and customer credit", async () => {
  const pool = getDatabasePool();
  const unique = String(Date.now());
  const businessIds = [];
  const sessionHashes = [];
  const cookieName = authSessionCookieName();
  const originHeaders = { Origin: "http://localhost:3000", "Content-Type": "application/json" };
  let businessId;
  let branchId;
  let otherBranchId;
  let productId;
  let customerId;
  let cashAccountId;
  let mtnAccountId;
  let otherBranchCashAccountId;
  let adminToken;
  let managerToken;

  function request(path, token, options = {}) {
    return new NextRequest(`http://localhost:3000${path}`, {
      ...options,
      headers: {
        Cookie: `${cookieName}=${token}`,
        ...(options.method === "GET" ? {} : originHeaders),
        ...options.headers,
      },
    });
  }

  try {
    await withTransaction(async (client) => {
      const business = await createBusiness(client, { name: `POS ${unique}` });
      businessId = business.id;
      businessIds.push(business.id);
      const admin = await createAdminUser(client, {
        businessId: business.id,
        username: `pos.admin.${unique.slice(-8)}`,
        fullName: "POS Admin",
        email: `pos-admin-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [admin.id]);
      const branch = await createBranch(client, business.id, { name: "POS Main" }, true);
      const otherBranch = await createBranch(client, business.id, { name: "POS Other" }, true);
      branchId = branch.id;
      otherBranchId = otherBranch.id;
      const manager = await createManagerUser(client, {
        businessId: business.id,
        branchId: branch.id,
        username: `pos.manager.${unique.slice(-8)}`,
        fullName: "POS Manager",
        passwordHash: "$argon2id$integration-test",
      });
      await seedDefaultManagerPermissions(client, business.id);
      await client.query(
        `UPDATE business_manager_permissions
         SET enabled = TRUE
         WHERE business_id = $1 AND permission_id = 'pos.use'`,
        [business.id],
      );
      const accounts = await client.query(
        `INSERT INTO cash_accounts (business_id, branch_id, account_type, name)
         VALUES
           ($1, $2, 'cash_drawer', 'POS cash'),
           ($1, $2, 'mtn_wallet', 'POS MTN'),
           ($1, $3, 'cash_drawer', 'Other branch POS cash')
         RETURNING id, name`,
        [business.id, branch.id, otherBranch.id],
      );
      cashAccountId = accounts.rows.find((account) => account.name === "POS cash").id;
      mtnAccountId = accounts.rows.find((account) => account.name === "POS MTN").id;
      otherBranchCashAccountId = accounts.rows.find((account) => account.name === "Other branch POS cash").id;
      await client.query(
        `INSERT INTO cash_account_openings
           (business_id, account_id, opening_amount, entered_by_user_id, authorized_by_user_id)
         VALUES ($1, $2, 50000, $5, $5), ($1, $3, 10000, $5, $5), ($1, $4, 50000, $5, $5)`,
        [business.id, cashAccountId, mtnAccountId, otherBranchCashAccountId, admin.id],
      );

      const customer = await client.query(
        `INSERT INTO customers (business_id, name, credit_limit)
         VALUES ($1, $2, $3) RETURNING id`,
        [business.id, "POS Customer", 50000],
      );
      customerId = customer.rows[0].id;
      const unit = await client.query(`SELECT id FROM units WHERE code = 'pc'`);
      const product = await client.query(
        `INSERT INTO products
           (business_id, name, sku, base_unit_id, purchase_price, selling_price)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [business.id, "POS Cement", `POS-${unique.slice(-8)}`, unit.rows[0].id, 8000, 12000],
      );
      productId = product.rows[0].id;

      const movement = await client.query(
        `INSERT INTO stock_movements
           (business_id, branch_id, product_id, movement_type, quantity_delta,
            unit_cost, total_cost, previous_quantity, new_quantity)
         VALUES ($1, $2, $3, 'opening_stock', 10000, 8000, 80000, 0, 10000)
         RETURNING id`,
        [business.id, branchId, productId],
      );
      await client.query(
        `INSERT INTO inventory_balances
           (business_id, branch_id, product_id, quantity_on_hand, average_unit_cost)
         VALUES ($1, $2, $3, 10000, 8000)`,
        [business.id, branchId, productId],
      );
      await client.query(
        `INSERT INTO inventory_cost_layers
           (business_id, branch_id, product_id, source_movement_id, source_type,
            quantity_received, quantity_remaining, unit_cost)
         VALUES ($1, $2, $3, $4, 'opening_stock', 10000, 10000, 8000)`,
        [business.id, branchId, productId, movement.rows[0].id],
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
      assert.ok(otherBranch.id);
    });

    const paymentAccounts = await getPosPaymentAccounts(request(
      `/api/pos/payment-options?branchId=${branchId}`,
      managerToken,
      { method: "GET" },
    ));
    assert.equal(paymentAccounts.status, 200);
    const availableAccounts = (await paymentAccounts.json()).accounts;
    assert.deepEqual(
      availableAccounts.map((account) => account.id).sort(),
      [cashAccountId, mtnAccountId].sort(),
    );
    assert.ok(availableAccounts.every((account) => !("available_balance" in account)));
    const otherBranchAccounts = await getPosPaymentAccounts(request(
      `/api/pos/payment-options?branchId=${otherBranchId}`,
      managerToken,
      { method: "GET" },
    ));
    assert.equal(otherBranchAccounts.status, 403);

    const productList = await getPosProducts(request(
      `/api/pos/products?branchId=${branchId}&search=cement&offset=0&limit=30`,
      managerToken,
    ));
    assert.equal(productList.status, 200);
    assert.equal((await productList.json()).items[0].quantity_on_hand, 10000);

    const paid = await checkoutPos(request("/api/pos/checkout", managerToken, {
      method: "POST",
      body: JSON.stringify({
        branchId,
        customerId: null,
        items: [{ productId, quantity: 2000, sellingPrice: 12000, priceChangeReason: null }],
        payments: [
          { paymentMethod: "cash", amount: 12000, cashAccountId },
          { paymentMethod: "mtn_mobile_money", amount: 12000, cashAccountId: mtnAccountId },
        ],
      }),
    }));
    assert.equal(paid.status, 201);
    const paidReceipt = (await paid.json()).receipt;
    assert.equal(paidReceipt.total, 24000);
    assert.equal(paidReceipt.amount_paid, 24000);
    assert.equal(paidReceipt.balance_due, 0);

    const credit = await checkoutPos(request("/api/pos/checkout", adminToken, {
      method: "POST",
      body: JSON.stringify({
        branchId,
        customerId,
        items: [{ productId, quantity: 1000, sellingPrice: 10000, priceChangeReason: "Manager discount" }],
        payments: [{ paymentMethod: "cash", amount: 5000, cashAccountId }],
      }),
    }));
    assert.equal(credit.status, 201);
    const creditReceipt = (await credit.json()).receipt;
    assert.equal(creditReceipt.total, 10000);
    assert.equal(creditReceipt.amount_paid, 5000);
    assert.equal(creditReceipt.balance_due, 5000);

    const cashBalance = await accountBalance(pool, businessId, cashAccountId);
    const mtnBalance = await accountBalance(pool, businessId, mtnAccountId);
    assert.equal(cashBalance, 67000);
    assert.equal(mtnBalance, 22000);
    const saleMovements = await pool.query(
      `SELECT sp.payment_method AS "paymentMethod", sp.amount::text AS amount,
              sp.cash_account_id AS "cashAccountId", cm.account_id AS "movementAccountId",
              cm.direction, cm.amount::text AS "movementAmount"
       FROM sale_payments sp
       LEFT JOIN cash_movements cm
         ON cm.business_id = sp.business_id
        AND cm.source_id = sp.id
        AND cm.source_type = 'sale_payment'
       WHERE sp.business_id = $1
       ORDER BY sp.created_at, sp.id`,
      [businessId],
    );
    assert.equal(saleMovements.rowCount, 3);
    assert.ok(saleMovements.rows.every((row) =>
      row.cashAccountId === row.movementAccountId &&
      row.amount === row.movementAmount &&
      row.direction === "in"));

    const wrongBranchAccount = await checkoutPos(request("/api/pos/checkout", adminToken, {
      method: "POST",
      body: JSON.stringify({
        branchId,
        customerId: null,
        items: [{ productId, quantity: 1000, sellingPrice: 12000, priceChangeReason: null }],
        payments: [{ paymentMethod: "cash", amount: 12000, cashAccountId: otherBranchCashAccountId }],
      }),
    }));
    assert.equal(wrongBranchAccount.status, 403);
    const wrongMethodAccount = await checkoutPos(request("/api/pos/checkout", adminToken, {
      method: "POST",
      body: JSON.stringify({
        branchId,
        customerId: null,
        items: [{ productId, quantity: 1000, sellingPrice: 12000, priceChangeReason: null }],
        payments: [{ paymentMethod: "cash", amount: 12000, cashAccountId: mtnAccountId }],
      }),
    }));
    assert.equal(wrongMethodAccount.status, 400);

    const overStock = await checkoutPos(request("/api/pos/checkout", adminToken, {
      method: "POST",
      body: JSON.stringify({
        branchId,
        customerId: null,
        items: [{ productId, quantity: 100000, sellingPrice: 12000, priceChangeReason: null }],
        payments: [{ paymentMethod: "cash", amount: 1200000, cashAccountId }],
      }),
    }));
    assert.equal(overStock.status, 400);

    const balance = await pool.query(
      `SELECT quantity_on_hand::text AS quantity
       FROM inventory_balances
       WHERE business_id = $1 AND branch_id = $2 AND product_id = $3`,
      [businessId, branchId, productId],
    );
    assert.equal(balance.rows[0].quantity, "7000");
    assert.equal(await accountBalance(pool, businessId, cashAccountId), 67000);
    assert.equal(await accountBalance(pool, businessId, mtnAccountId), 22000);

    const debt = await pool.query(
      `SELECT original_amount::text AS amount
       FROM customer_debts
       WHERE business_id = $1 AND customer_id = $2`,
      [businessId, customerId],
    );
    assert.equal(debt.rows[0].amount, "5000");
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
      await pool.query("DELETE FROM inventory_cost_layers WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM stock_movements WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM inventory_balances WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM customers WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM products WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_account_openings WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_accounts WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM business_manager_permissions WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM branches WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
    await pool.end();
  }
});
