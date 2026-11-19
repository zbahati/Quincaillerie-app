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
  { GET: getPurchases, POST: postPurchase },
  { POST: postReceipt },
  { GET: getPurchasePaymentOptions },
  { POST: postPurchasePayment },
  { GET: getPurchaseHistory },
  { GET: getPurchaseProducts },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/repositories/branches.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/repositories/manager-permissions.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/app/api/purchases/route.ts"),
  import("../../src/app/api/purchases/[purchaseId]/receipts/route.ts"),
  import("../../src/app/api/purchases/payment-options/route.ts"),
  import("../../src/app/api/purchases/[purchaseId]/payments/route.ts"),
  import("../../src/app/api/purchases/history/route.ts"),
  import("../../src/app/api/purchases/products/route.ts"),
]);

test("purchase invoices support duplicate confirmation, branch scope and partial FIFO receipts", async () => {
  const pool = getDatabasePool();
  const unique = String(Date.now());
  const businessIds = [];
  const sessionHashes = [];
  const cookieName = authSessionCookieName();
  const originHeaders = { Origin: "http://localhost:3000", "Content-Type": "application/json" };
  let businessId;
  let branchId;
  let otherBranchId;
  let supplierId;
  let productId;
  let branchCashAccountId;
  let otherBranchCashAccountId;
  let lowBalanceCashAccountId;
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
      const business = await createBusiness(client, { name: `Purchases ${unique}` });
      businessId = business.id;
      businessIds.push(business.id);
      const admin = await createAdminUser(client, {
        businessId: business.id,
        username: `purchase.admin.${unique.slice(-8)}`,
        fullName: "Purchase Admin",
        email: `purchase-admin-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [admin.id]);
      const branch = await createBranch(client, business.id, { name: "Main purchase branch" }, true);
      const otherBranch = await createBranch(client, business.id, { name: "Other purchase branch" }, true);
      branchId = branch.id;
      otherBranchId = otherBranch.id;
      const manager = await createManagerUser(client, {
        businessId: business.id,
        branchId: branch.id,
        username: `purchase.manager.${unique.slice(-8)}`,
        fullName: "Purchase Manager",
        passwordHash: "$argon2id$integration-test",
      });
      await seedDefaultManagerPermissions(client, business.id);
      await client.query(
        `UPDATE business_manager_permissions
         SET enabled = TRUE
         WHERE business_id = $1 AND permission_id IN ('purchases.read','purchases.manage','suppliers.read','inventory.read','inventory.manage')`,
        [business.id],
      );
      const accounts = await client.query(
        `INSERT INTO cash_accounts (business_id, branch_id, account_type, name)
         VALUES
           ($1, $2, 'cash_drawer', $3),
           ($1, $4, 'cash_drawer', $5),
           ($1, $2, 'cash_drawer', $6)
         RETURNING id, name`,
        [
          business.id,
          branch.id,
          `Main purchase cash ${unique}`,
          otherBranch.id,
          `Other branch cash ${unique}`,
          `Low balance cash ${unique}`,
        ],
      );
      branchCashAccountId = accounts.rows.find((account) => account.name === `Main purchase cash ${unique}`).id;
      otherBranchCashAccountId = accounts.rows.find((account) => account.name === `Other branch cash ${unique}`).id;
      lowBalanceCashAccountId = accounts.rows.find((account) => account.name === `Low balance cash ${unique}`).id;
      await client.query(
        `INSERT INTO cash_account_openings
           (business_id, account_id, opening_amount, entered_by_user_id, authorized_by_user_id)
         VALUES ($1, $2, 1000000, $3, $3), ($1, $4, 1000000, $3, $3), ($1, $5, 100, $3, $3)`,
        [business.id, branchCashAccountId, admin.id, otherBranchCashAccountId, lowBalanceCashAccountId],
      );

      const supplier = await client.query(
        `INSERT INTO suppliers (business_id, name)
         VALUES ($1, $2) RETURNING id`,
        [business.id, `Purchase Supplier ${unique}`],
      );
      supplierId = supplier.rows[0].id;

      const baseUnit = await client.query(
        `SELECT id FROM units WHERE code = 'pc' LIMIT 1`,
      );
      const product = await client.query(
        `INSERT INTO products
           (business_id, name, sku, base_unit_id, purchase_price, selling_price, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         RETURNING id`,
        [business.id, `Purchase Cement ${unique}`, `P-CEMENT-${unique.slice(-8)}`, baseUnit.rows[0].id, 10000, 15000],
      );
      productId = product.rows[0].id;

      for (const [userId, token, businessTokenId] of [
        [admin.id, createOpaqueToken(), business.id],
        [manager.id, createOpaqueToken(), business.id],
      ]) {
        const tokenHash = hashOpaqueToken(token);
        sessionHashes.push(tokenHash);
        await createAuthSession(client, {
          businessId: businessTokenId,
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        });
        if (userId === admin.id) adminToken = token;
        if (userId === manager.id) managerToken = token;
      }
    });

    const productsResponse = await getPurchaseProducts(request("/api/purchases/products", adminToken));
    assert.equal(productsResponse.status, 200);
    assert.equal((await productsResponse.json()).products[0].id, productId);

    const createBody = {
      branchId,
      supplierId,
      supplierInvoiceNumber: `INV-${unique}`,
      authorizeDuplicate: false,
      items: [{ productId, orderedQuantity: 10000, unitCost: 12000 }],
    };
    const first = await postPurchase(request("/api/purchases", adminToken, {
      method: "POST",
      body: JSON.stringify(createBody),
    }));
    assert.equal(first.status, 201);
    const purchase = (await first.json()).purchase;
    assert.equal(purchase.subtotal, 120000);
    assert.equal(purchase.status, "pending");

    const duplicate = await postPurchase(request("/api/purchases", adminToken, {
      method: "POST",
      body: JSON.stringify(createBody),
    }));
    assert.equal(duplicate.status, 409);

    const authorized = await postPurchase(request("/api/purchases", adminToken, {
      method: "POST",
      body: JSON.stringify({ ...createBody, authorizeDuplicate: true }),
    }));
    assert.equal(authorized.status, 201);
    const duplicatePurchase = (await authorized.json()).purchase;
    assert.equal(duplicatePurchase.duplicate_authorized, true);
    assert.equal(duplicatePurchase.duplicate_of_purchase_id, purchase.id);

    const partial = await postReceipt(
      request(`/api/purchases/${purchase.id}/receipts`, adminToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          deliveryReference: "DN-001",
          notes: "First delivery",
          items: [{ purchaseItemId: purchase.items[0].id, quantity: 4000 }],
        }),
      }),
      { params: Promise.resolve({ purchaseId: purchase.id }) },
    );
    assert.equal(partial.status, 201);
    assert.equal((await partial.json()).receipt.status, "partially_received");

    const second = await postReceipt(
      request(`/api/purchases/${purchase.id}/receipts`, managerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          deliveryReference: "DN-002",
          notes: "Final delivery",
          items: [{ purchaseItemId: purchase.items[0].id, quantity: 6000 }],
        }),
      }),
      { params: Promise.resolve({ purchaseId: purchase.id }) },
    );
    assert.equal(second.status, 201);
    assert.equal((await second.json()).receipt.status, "received");

    const paymentOptions = await getPurchasePaymentOptions(
      request(`/api/purchases/payment-options?branchId=${branchId}`, managerToken),
    );
    assert.equal(paymentOptions.status, 200);
    const availableAccounts = (await paymentOptions.json()).accounts;
    assert.ok(availableAccounts.some((account) => account.id === branchCashAccountId));
    assert.ok(availableAccounts.some((account) => account.id === lowBalanceCashAccountId));
    assert.ok(!availableAccounts.some((account) => account.id === otherBranchCashAccountId));
    const otherBranchOptions = await getPurchasePaymentOptions(
      request(`/api/purchases/payment-options?branchId=${otherBranchId}`, managerToken),
    );
    assert.equal(otherBranchOptions.status, 403);

    const insufficientFunds = await postPurchasePayment(
      request(`/api/purchases/${purchase.id}/payments`, managerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          amount: 200,
          paymentMethod: "cash",
          cashAccountId: lowBalanceCashAccountId,
        }),
      }),
      { params: Promise.resolve({ purchaseId: purchase.id }) },
    );
    assert.equal(insufficientFunds.status, 400);

    const wrongAccountBranch = await postPurchasePayment(
      request(`/api/purchases/${purchase.id}/payments`, managerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          amount: 1000,
          paymentMethod: "cash",
          cashAccountId: otherBranchCashAccountId,
        }),
      }),
      { params: Promise.resolve({ purchaseId: purchase.id }) },
    );
    assert.equal(wrongAccountBranch.status, 403);

    const accountTypeMismatch = await postPurchasePayment(
      request(`/api/purchases/${purchase.id}/payments`, managerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          amount: 1000,
          paymentMethod: "bank_transfer",
          cashAccountId: branchCashAccountId,
        }),
      }),
      { params: Promise.resolve({ purchaseId: purchase.id }) },
    );
    assert.equal(accountTypeMismatch.status, 400);

    const partialPayment = await postPurchasePayment(
      request(`/api/purchases/${purchase.id}/payments`, managerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          amount: 50000,
          paymentMethod: "cash",
          cashAccountId: branchCashAccountId,
        }),
      }),
      { params: Promise.resolve({ purchaseId: purchase.id }) },
    );
    assert.equal(partialPayment.status, 201);
    const partiallyPaid = (await partialPayment.json()).purchase;
    assert.equal(partiallyPaid.amount_paid, 50000);
    assert.equal(partiallyPaid.balance_due, 70000);
    assert.equal(partiallyPaid.payments.length, 1);

    const overpayment = await postPurchasePayment(
      request(`/api/purchases/${purchase.id}/payments`, managerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          amount: 70001,
          paymentMethod: "cash",
          cashAccountId: branchCashAccountId,
        }),
      }),
      { params: Promise.resolve({ purchaseId: purchase.id }) },
    );
    assert.equal(overpayment.status, 400);

    const over = await postReceipt(
      request(`/api/purchases/${purchase.id}/receipts`, adminToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          items: [{ purchaseItemId: purchase.items[0].id, quantity: 1 }],
        }),
      }),
      { params: Promise.resolve({ purchaseId: purchase.id }) },
    );
    assert.equal(over.status, 400);

    const listMain = await getPurchases(request(`/api/purchases?branchId=${branchId}`, adminToken));
    assert.equal(listMain.status, 200);
    assert.equal((await listMain.json()).purchases.length, 2);
    const listOther = await getPurchases(request(`/api/purchases?branchId=${otherBranchId}`, managerToken));
    assert.equal(listOther.status, 403);

    const balance = await pool.query(
      `SELECT quantity_on_hand::text AS quantity
       FROM inventory_balances
       WHERE business_id = $1 AND branch_id = $2 AND product_id = $3`,
      [businessId, branchId, productId],
    );
    assert.equal(balance.rows[0].quantity, "10000");

    const layers = await pool.query(
      `SELECT quantity_remaining::text AS remaining
       FROM inventory_cost_layers
       WHERE business_id = $1 AND branch_id = $2 AND product_id = $3
       ORDER BY created_at`,
      [businessId, branchId, productId],
    );
    assert.equal(layers.rows[0].remaining, "4000");

    const finalPayment = await postPurchasePayment(
      request(`/api/purchases/${purchase.id}/payments`, managerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          amount: 70000,
          paymentMethod: "cash",
          cashAccountId: branchCashAccountId,
        }),
      }),
      { params: Promise.resolve({ purchaseId: purchase.id }) },
    );
    assert.equal(finalPayment.status, 201);
    const fullyPaid = (await finalPayment.json()).purchase;
    assert.equal(fullyPaid.amount_paid, fullyPaid.subtotal);
    assert.equal(fullyPaid.balance_due, 0);

    const openAfterPayment = await getPurchases(request(`/api/purchases?branchId=${branchId}`, adminToken));
    assert.equal((await openAfterPayment.json()).purchases.some((item) => item.id === purchase.id), false);

    const today = new Date().toISOString().slice(0, 10);
    const historyResponse = await getPurchaseHistory(
      request(`/api/purchases/history?branchId=${branchId}&search=DN-002&fromDate=${today}&toDate=${today}&limit=30`, managerToken),
    );
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.equal(history.total_count, 1);
    assert.equal(history.purchase_total, 120000);
    assert.equal(history.paid_total, 120000);
    assert.equal(history.balance_due_total, 0);
    assert.equal(history.items[0].id, purchase.id);

    const invalidHistoryRange = await getPurchaseHistory(
      request(`/api/purchases/history?branchId=${branchId}&fromDate=2026-02-31&toDate=2026-03-01`, adminToken),
    );
    assert.equal(invalidHistoryRange.status, 400);

    const accountBalance = await pool.query(
      `SELECT o.opening_amount - COALESCE(SUM(m.amount) FILTER (WHERE m.direction = 'out'), 0)
              + COALESCE(SUM(m.amount) FILTER (WHERE m.direction = 'in'), 0) AS balance
       FROM cash_account_openings o
       LEFT JOIN cash_movements m
         ON m.business_id = o.business_id AND m.account_id = o.account_id
       WHERE o.business_id = $1 AND o.account_id = $2
       GROUP BY o.opening_amount`,
      [businessId, branchCashAccountId],
    );
    assert.equal(accountBalance.rows[0].balance, "880000");

    const movementCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM cash_movements
       WHERE business_id = $1 AND source_type = 'purchase_payment'`,
      [businessId],
    );
    assert.equal(movementCount.rows[0].count, 2);
  } finally {
    if (sessionHashes.length) {
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = ANY($1::bytea[])", [sessionHashes]);
    }
    for (const businessId of businessIds) {
      await pool.query("DELETE FROM audit_logs WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_movements WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM purchase_payments WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_account_openings WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_accounts WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM inventory_cost_layers WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM stock_movements WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM purchase_receipt_items WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM purchase_receipts WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM purchase_items WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM purchases WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM inventory_balances WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM products WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM suppliers WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM business_manager_permissions WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM branches WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
    await pool.end();
  }
});
