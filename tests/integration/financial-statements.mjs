import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required.");
process.env.DATABASE_URL = testDatabaseUrl;

test("income statement derives COGS and balance sheet derives branch assets and liabilities", async () => {
  const [
    { getDatabasePool },
    { withTransaction },
    { createBusiness },
    { createBranch },
    { createAdminUser },
    { createAuthSession },
    { createOpaqueToken, hashOpaqueToken, authSessionCookieName },
    { GET: getBalanceSheetRoute },
  ] = await Promise.all([
    import("../../src/lib/server/db/pool.ts"),
    import("../../src/lib/server/db/transaction.ts"),
    import("../../src/lib/server/repositories/businesses.ts"),
    import("../../src/lib/server/repositories/branches.ts"),
    import("../../src/lib/server/repositories/users.ts"),
    import("../../src/lib/server/repositories/auth-sessions.ts"),
    import("../../src/lib/server/auth/crypto.ts"),
    import("../../src/app/api/reports/balance-sheet/route.ts"),
  ]);
  const { calculateIncomeStatement, calculateBalanceSheet } =
    await import("../../src/lib/server/repositories/reports.ts");
  const pool = getDatabasePool();
  const unique = String(Date.now());
  const date = new Date().toISOString().slice(0, 10);
  let businessId;
  let branchId;
  let secondaryBranchId;
  let accountId;
  let sessionHash;
  let sessionToken;

  try {
    await withTransaction(async (client) => {
      const business = await createBusiness(client, { name: `Statements ${unique}` });
      businessId = business.id;
      const admin = await createAdminUser(client, {
        businessId,
        username: `statements.admin.${unique.slice(-8)}`,
        fullName: "Statements Admin",
        email: `statements-admin-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [admin.id]);
      sessionToken = createOpaqueToken();
      sessionHash = hashOpaqueToken(sessionToken);
      await createAuthSession(client, {
        businessId,
        userId: admin.id,
        tokenHash: sessionHash,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const branch = await createBranch(client, businessId, { name: "Statements branch" }, true);
      branchId = branch.id;
      secondaryBranchId = (await createBranch(client, businessId, { name: "Other statements branch" }, true)).id;
      const customer = await client.query(
        `INSERT INTO customers (business_id, branch_id, name, credit_limit)
         VALUES ($1, $2, 'Statement customer', 50000)
         RETURNING id`,
        [businessId, branchId],
      );
      await client.query(
        `INSERT INTO sales
           (business_id, branch_id, transaction_number, subtotal, total, customer_id)
         VALUES ($1, $2, $3, 24000, 24000, $4)`,
        [businessId, branchId, `STATEMENT-${unique}`, customer.rows[0].id],
      );
      const sale = await client.query(
        `SELECT id FROM sales WHERE business_id = $1 AND transaction_number = $2`,
        [businessId, `STATEMENT-${unique}`],
      );
      const unit = await client.query(`SELECT id FROM units WHERE code = 'pc'`);
      const product = await client.query(
        `INSERT INTO products
           (business_id, name, sku, base_unit_id, purchase_price, selling_price)
         VALUES ($1, 'Statement product', $2, $3, 8000, 12000)
         RETURNING id`,
        [businessId, `STAT-${unique.slice(-8)}`, unit.rows[0].id],
      );
      await client.query(
        `INSERT INTO sale_items
           (business_id, sale_id, product_id, product_name, sku, quantity, unit_name,
            listed_unit_price, unit_price, line_total, unit_cost, total_cost)
         VALUES ($1, $2, $3, 'Statement product', $4, 2000, 'Piece',
                 12000, 12000, 24000, 8000, 16000)`,
        [businessId, sale.rows[0].id, product.rows[0].id, `STAT-${unique.slice(-8)}`],
      );
      await client.query(
        `INSERT INTO inventory_balances
           (business_id, branch_id, product_id, quantity_on_hand, average_unit_cost)
         VALUES ($1, $2, $3, 11000, 8000)`,
        [businessId, branchId, product.rows[0].id],
      );
      const fractionalProduct = await client.query(
        `INSERT INTO products
           (business_id, name, sku, base_unit_id, purchase_price, selling_price)
         VALUES ($1, 'Fractional value product', $2, $3, 3333, 5000)
         RETURNING id`,
        [businessId, `FRAC-${unique.slice(-8)}`, unit.rows[0].id],
      );
      await client.query(
        `INSERT INTO inventory_balances
           (business_id, branch_id, product_id, quantity_on_hand, average_unit_cost)
         VALUES ($1, $2, $3, 1500, 3333)`,
        [businessId, branchId, fractionalProduct.rows[0].id],
      );
      await client.query(
        `INSERT INTO stock_movements
           (business_id, branch_id, product_id, movement_type, quantity_delta,
            previous_quantity, new_quantity, created_at)
         VALUES ($1, $2, $3, 'stock_correction', 1000, 10000, 11000,
                 ($4::date + interval '1 day')::timestamptz)`,
        [businessId, branchId, product.rows[0].id, date],
      );
      await client.query(
        `INSERT INTO expenses
           (business_id, branch_id, category, amount, expense_date, payment_method, description, responsible_name)
         VALUES ($1, $2, 'rent', 5000, $3, 'cash', 'Rent', 'Statement Admin')`,
        [businessId, branchId, date],
      );
      const supplier = await client.query(
        `INSERT INTO suppliers (business_id, branch_id, name)
         VALUES ($1, $2, 'Statement supplier') RETURNING id`,
        [businessId, branchId],
      );
      const purchase = await client.query(
        `INSERT INTO purchases
           (business_id, branch_id, supplier_id, supplier_invoice_number, subtotal)
         VALUES ($1, $2, $3, $4, 30000)
         RETURNING id`,
        [businessId, branchId, supplier.rows[0].id, `STATEMENT-PURCHASE-${unique}`],
      );
      const account = await client.query(
        `INSERT INTO cash_accounts (business_id, branch_id, account_type, name)
         VALUES ($1, $2, 'cash_drawer', 'Statement cash')
         RETURNING id`,
        [businessId, branchId],
      );
      accountId = account.rows[0].id;
      await client.query(
        `INSERT INTO cash_account_openings
           (business_id, account_id, opening_amount, entered_by_user_id, authorized_by_user_id)
         VALUES ($1, $2, 0, $3, $3)`,
        [businessId, accountId, admin.id],
      );
      const secondaryAccount = await client.query(
        `INSERT INTO cash_accounts (business_id, branch_id, account_type, name)
         VALUES ($1, $2, 'cash_drawer', 'Other branch cash')
         RETURNING id`,
        [businessId, secondaryBranchId],
      );
      await client.query(
        `INSERT INTO cash_account_openings
           (business_id, account_id, opening_amount, entered_by_user_id, authorized_by_user_id)
         VALUES ($1, $2, 99000, $3, $3)`,
        [businessId, secondaryAccount.rows[0].id, admin.id],
      );
      await client.query(
        `INSERT INTO expenses
           (business_id, branch_id, category, amount, expense_date, payment_method, description, responsible_name)
         VALUES ($1, $2, 'rent', 17000, $3, 'cash', 'Other branch rent', 'Statements Admin')`,
        [businessId, secondaryBranchId, date],
      );
      const salePayment = await client.query(
        `INSERT INTO sale_payments
           (business_id, sale_id, payment_method, amount, cash_account_id)
         VALUES ($1, $2, 'cash', 10000, $3)
         RETURNING id`,
        [businessId, sale.rows[0].id, accountId],
      );
      await client.query(
        `INSERT INTO cash_movements
           (business_id, account_id, movement_type, direction, amount, source_type,
            source_id, recorded_at, description)
         SELECT $1, $2, 'sale_collection', 'in', 10000, 'sale_payment', $3,
                created_at, 'Statement fixture sale'
         FROM sale_payments WHERE business_id = $1 AND id = $3`,
        [businessId, accountId, salePayment.rows[0].id],
      );
      const debt = await client.query(
        `INSERT INTO customer_debts
           (business_id, customer_id, sale_id, original_amount)
         VALUES ($1, $2, $3, 24000)
         RETURNING id`,
        [businessId, customer.rows[0].id, sale.rows[0].id],
      );
      await client.query(
        `INSERT INTO customer_debt_payments
           (business_id, debt_id, payment_method, amount)
         VALUES ($1, $2, 'cash', 15000)`,
        [businessId, debt.rows[0].id],
      );
      const supplierPayment = await client.query(
        `INSERT INTO purchase_payments
           (business_id, purchase_id, payment_method, amount, cash_account_id)
         VALUES ($1, $2, 'cash', 4000, $3)
         RETURNING id`,
        [businessId, purchase.rows[0].id, accountId],
      );
      await client.query(
        `INSERT INTO cash_movements
           (business_id, account_id, movement_type, direction, amount, source_type, source_id)
         VALUES
           ($1, $2, 'other_receipt', 'in', 10000, 'other', NULL),
           ($1, $2, 'supplier_payment', 'out', 4000, 'purchase_payment', $3)`,
        [businessId, account.rows[0].id, supplierPayment.rows[0].id],
      );
    });

    const income = await calculateIncomeStatement(pool, businessId, branchId, date, date);
    assert.equal(income.salesTotal, 24000);
    assert.equal(income.costOfGoodsSold, 16000);
    assert.equal(income.grossProfit, 8000);
    assert.equal(income.expensesTotal, 5000);
    assert.equal(income.operatingResult, 3000);

    const balance = await calculateBalanceSheet(pool, businessId, branchId, date);
    assert.equal(balance.inventory, 85000);
    assert.equal(balance.accountsReceivable, 0);
    assert.equal(balance.cashAndBank, 16000);
    assert.equal(balance.accountsPayable, 26000);
    assert.equal(balance.retainedEarnings, 3000);
    assert.equal(balance.totalAssets, 101000);
    assert.equal(balance.ownerEquity, 72000);
    assert.equal(balance.totalLiabilitiesAndEquity, balance.totalAssets);
    for (const amount of [
      balance.inventory,
      balance.accountsReceivable,
      balance.cashAndBank,
      balance.accountsPayable,
      balance.retainedEarnings,
      balance.ownerEquity,
      balance.totalAssets,
      balance.totalLiabilitiesAndEquity,
    ]) {
      assert.equal(amount % 100, 0);
    }

    const apiResponse = await getBalanceSheetRoute(new NextRequest(
      `http://localhost:3000/api/reports/balance-sheet?branchId=${branchId}&reportDate=${date}`,
      { headers: { Cookie: `${authSessionCookieName()}=${sessionToken}` } },
    ));
    assert.equal(apiResponse.status, 200);
    assert.equal((await apiResponse.json()).accounts_receivable, 0);

    await pool.query(
      `INSERT INTO cash_movements
         (business_id, account_id, movement_type, direction, amount, source_type)
         VALUES ($1, $2, 'other_payment', 'out', 17000, 'other')`,
      [businessId, accountId],
    );
    await assert.rejects(
      calculateBalanceSheet(pool, businessId, branchId, date),
      /cash account balance is negative/,
    );
  } finally {
    if (businessId) {
      if (sessionHash) {
        await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [sessionHash]);
      }
      await pool.query("DELETE FROM cash_movements WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM sale_items WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM customer_debt_payments WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM customer_debts WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM sale_payments WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM sales WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM expenses WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM inventory_balances WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM stock_movements WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM purchase_payments WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_account_openings WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_accounts WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM purchases WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM products WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM customers WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM suppliers WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM branches WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
    await pool.end();
  }
});
