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
  { GET: getDebts },
  { POST: postPayment },
  { GET: getStatement },
  { GET: getPaymentOptions },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/repositories/branches.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/repositories/manager-permissions.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/app/api/customer-debt/route.ts"),
  import("../../src/app/api/customer-debt/[debtId]/payment/route.ts"),
  import("../../src/app/api/customers/[customerId]/statement/route.ts"),
  import("../../src/app/api/customer-debt/payment-options/route.ts"),
]);

test("customer statements reconcile sale payments and later repayments", async () => {
  const pool = getDatabasePool();
  const unique = String(Date.now());
  const date = new Date().toISOString().slice(0, 10);
  const businessIds = [];
  const sessionHashes = [];
  const cookieName = authSessionCookieName();
  const originHeaders = { Origin: "http://localhost:3000", "Content-Type": "application/json" };
  let branchId;
  let secondaryBranchId;
  let customerId;
  let secondaryCustomerId;
  let debtId;
  let secondaryDebtId;
  let cashAccountId;
  let mtnAccountId;
  let inactiveBankAccountId;
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
      const business = await createBusiness(client, { name: `Debt ${unique}` });
      businessIds.push(business.id);
      const admin = await createAdminUser(client, {
        businessId: business.id,
        username: `debt.admin.${unique.slice(-8)}`,
        fullName: "Debt Admin",
        email: `debt-admin-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [admin.id]);
      const branch = await createBranch(client, business.id, { name: "Debt Main" }, true);
      branchId = branch.id;
      const secondaryBranch = await createBranch(client, business.id, { name: "Debt Secondary" }, true);
      secondaryBranchId = secondaryBranch.id;
      const cashAccount = await client.query(
        `INSERT INTO cash_accounts (business_id, branch_id, account_type, name)
         VALUES ($1, $2, 'cash_drawer', 'Debt sale cash')
         RETURNING id`,
        [business.id, branchId],
      );
      cashAccountId = cashAccount.rows[0].id;
      await client.query(
        `INSERT INTO cash_account_openings
           (business_id, account_id, opening_amount, entered_by_user_id, authorized_by_user_id)
         VALUES ($1, $2, 20000, $3, $3)`,
        [business.id, cashAccountId, admin.id],
      );
      const mtnAccount = await client.query(
        `INSERT INTO cash_accounts (business_id, branch_id, account_type, name)
         VALUES ($1, $2, 'mtn_wallet', 'Debt MTN wallet')
         RETURNING id`,
        [business.id, branchId],
      );
      mtnAccountId = mtnAccount.rows[0].id;
      const inactiveBankAccount = await client.query(
        `INSERT INTO cash_accounts (business_id, branch_id, account_type, name, is_active)
         VALUES ($1, $2, 'bank', 'Inactive debt bank', FALSE)
         RETURNING id`,
        [business.id, branchId],
      );
      inactiveBankAccountId = inactiveBankAccount.rows[0].id;
      for (const accountId of [mtnAccountId, inactiveBankAccountId]) {
        await client.query(
          `INSERT INTO cash_account_openings
             (business_id, account_id, opening_amount, entered_by_user_id, authorized_by_user_id)
           VALUES ($1, $2, 0, $3, $3)`,
          [business.id, accountId, admin.id],
        );
      }
      const manager = await createManagerUser(client, {
        businessId: business.id,
        branchId: branch.id,
        username: `debt.manager.${unique.slice(-8)}`,
        fullName: "Debt Manager",
        passwordHash: "$argon2id$integration-test",
      });
      await seedDefaultManagerPermissions(client, business.id);
      await client.query(
        `UPDATE business_manager_permissions
         SET enabled = TRUE
         WHERE business_id = $1 AND permission_id IN (
           'customers.read','customer_debts.read','customer_payments.manage'
         )`,
        [business.id],
      );
      const customer = await client.query(
        `INSERT INTO customers (business_id, branch_id, name, credit_limit)
         VALUES ($1, $2, $3, 50000) RETURNING id`,
        [business.id, branchId, "Debt Customer"],
      );
      customerId = customer.rows[0].id;
      const sale = await client.query(
        `INSERT INTO sales
           (business_id, branch_id, transaction_number, subtotal, total,
            sold_by, customer_id)
         VALUES ($1, $2, $3, 24000, 24000, $4, $5)
         RETURNING id`,
        [business.id, branchId, `DEBT-${unique}`, admin.id, customerId],
      );
      const salePayment = await client.query(
        `INSERT INTO sale_payments
           (business_id, sale_id, payment_method, amount, cash_account_id)
         VALUES ($1, $2, 'cash', 10000, $3)
           RETURNING id`,
        [business.id, sale.rows[0].id, cashAccount.rows[0].id],
      );
      await client.query(
        `INSERT INTO cash_movements
           (business_id, account_id, movement_type, direction, amount, source_type,
            source_id, recorded_at, description)
         SELECT $1, $2, 'sale_collection', 'in', 10000, 'sale_payment', $3,
                created_at, 'Debt fixture sale'
         FROM sale_payments WHERE business_id = $1 AND id = $3`,
        [business.id, cashAccount.rows[0].id, salePayment.rows[0].id],
      );
      const debt = await client.query(
        `INSERT INTO customer_debts
           (business_id, customer_id, sale_id, original_amount)
         VALUES ($1, $2, $3, 24000)
         RETURNING id`,
        [business.id, customerId, sale.rows[0].id],
      );
      debtId = debt.rows[0].id;
      const secondaryCustomer = await client.query(
        `INSERT INTO customers (business_id, branch_id, name, credit_limit)
         VALUES ($1, $2, $3, 50000) RETURNING id`,
        [business.id, secondaryBranchId, "Secondary Debt Customer"],
      );
      secondaryCustomerId = secondaryCustomer.rows[0].id;
      const secondarySale = await client.query(
        `INSERT INTO sales
           (business_id, branch_id, transaction_number, subtotal, total,
            sold_by, customer_id)
         VALUES ($1, $2, $3, 5000, 5000, $4, $5)
         RETURNING id`,
        [business.id, secondaryBranchId, `DEBT-SECONDARY-${unique}`, admin.id, secondaryCustomerId],
      );
      const secondaryDebt = await client.query(
        `INSERT INTO customer_debts
           (business_id, customer_id, sale_id, original_amount)
         VALUES ($1, $2, $3, 5000)
         RETURNING id`,
        [business.id, secondaryCustomerId, secondarySale.rows[0].id],
      );
      secondaryDebtId = secondaryDebt.rows[0].id;

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

    const initialDebts = await getDebts(request("/api/customer-debt", managerToken));
    assert.equal(initialDebts.status, 200);
    const debtPage = await initialDebts.json();
    assert.equal(debtPage.debts.length, 1);
    assert.equal(debtPage.debts[0].branch_id, branchId);
    assert.equal(debtPage.debts[0].original_amount, 14000);
    assert.equal(debtPage.debts[0].balance_due, 14000);

    const secondaryBranchDebts = await getDebts(
      request(`/api/customer-debt?branchId=${secondaryBranchId}`, adminToken),
    );
    assert.equal(secondaryBranchDebts.status, 200);
    assert.deepEqual((await secondaryBranchDebts.json()).debts.map((debt) => debt.id), [secondaryDebtId]);

    const forbiddenBranchDebts = await getDebts(
      request(`/api/customer-debt?branchId=${secondaryBranchId}`, managerToken),
    );
    assert.equal(forbiddenBranchDebts.status, 403);

    const paymentOptionsResponse = await getPaymentOptions(
      request(`/api/customer-debt/payment-options?branchId=${branchId}`, managerToken),
    );
    assert.equal(paymentOptionsResponse.status, 200);
    const paymentOptions = await paymentOptionsResponse.json();
    assert.deepEqual(
      paymentOptions.accounts.map((account) => account.id).sort(),
      [cashAccountId, mtnAccountId].sort(),
    );

    const crossBranchStatement = await getStatement(
      request(`/api/customers/${secondaryCustomerId}/statement?branchId=${secondaryBranchId}`, managerToken),
      { params: Promise.resolve({ customerId: secondaryCustomerId }) },
    );
    assert.equal(crossBranchStatement.status, 403);

    const inactiveAccountPayment = await postPayment(
      request(`/api/customer-debt/${debtId}/payment`, managerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          paymentMethod: "bank_transfer",
          amount: 1000,
          cashAccountId: inactiveBankAccountId,
        }),
      }),
      { params: Promise.resolve({ debtId }) },
    );
    assert.equal(inactiveAccountPayment.status, 404);

    const repay = await postPayment(
      request(`/api/customer-debt/${debtId}/payment`, managerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          paymentMethod: "mtn_mobile_money",
          amount: 6000,
          cashAccountId: mtnAccountId,
        }),
      }),
      { params: Promise.resolve({ debtId }) },
    );
    assert.equal(repay.status, 201);
    const repaymentBody = await repay.json();
    assert.equal(repaymentBody.payment.balance_due, 8000);
    assert.equal(repaymentBody.payment.cash_account_id, mtnAccountId);

    const overpay = await postPayment(
      request(`/api/customer-debt/${debtId}/payment`, adminToken, {
        method: "POST",
        body: JSON.stringify({
          branchId,
          paymentMethod: "cash",
          amount: 8001,
          cashAccountId,
        }),
      }),
      { params: Promise.resolve({ debtId }) },
    );
    assert.equal(overpay.status, 400);

    const statement = await getStatement(
      request(`/api/customers/${customerId}/statement?branchId=${branchId}`, adminToken),
      { params: Promise.resolve({ customerId }) },
    );
    assert.equal(statement.status, 200);
    const body = await statement.json();
    assert.equal(body.total_sales, 24000);
    assert.equal(body.total_payments, 16000);
    assert.equal(body.outstanding_balance, 8000);
    assert.equal(body.entries.some((entry) => entry.entry_type === "repayment"), true);

    const { calculateDailyReport, calculateBalanceSheet } =
      await import("../../src/lib/server/repositories/reports.ts");
    const dailyReport = await calculateDailyReport(
      pool,
      businessIds[0],
      branchId,
      date,
      date,
    );
    assert.equal(dailyReport.customerRepayments, 6000);
    assert.equal(dailyReport.cashInflow, 16000);
    assert.equal(dailyReport.calculatedPhysicalCash, 36000);

    const balanceSheet = await calculateBalanceSheet(
      pool,
      businessIds[0],
      branchId,
      date,
    );
    assert.equal(balanceSheet.cashAndBank, 36000);
    assert.equal(balanceSheet.accountsReceivable, 8000);

    const repaymentMovement = await pool.query(
      `SELECT account_id, direction, amount::text AS amount
       FROM cash_movements
       WHERE business_id = $1 AND source_id = $2
         AND source_type = 'customer_debt_payment'`,
      [businessIds[0], repaymentBody.payment.id],
    );
    assert.equal(repaymentMovement.rowCount, 1);
    assert.equal(repaymentMovement.rows[0].account_id, mtnAccountId);
    assert.equal(repaymentMovement.rows[0].direction, "in");
    assert.equal(repaymentMovement.rows[0].amount, "6000");
  } finally {
    if (sessionHashes.length) {
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = ANY($1::bytea[])", [sessionHashes]);
    }
    for (const businessId of businessIds) {
      await pool.query("DELETE FROM audit_logs WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_movements WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM customer_debt_payments WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM customer_debts WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM sale_payments WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM sales WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_account_openings WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_accounts WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM customers WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM business_manager_permissions WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM branches WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
    await pool.end();
  }
});
