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
  { createAdminUser },
  { seedDefaultManagerPermissions },
  { createAuthSession },
  { createOpaqueToken, hashOpaqueToken, authSessionCookieName },
  { GET: getAccounts, POST: postAccount },
  { POST: postOpening },
  { GET: getExpenses, POST: postExpense },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/repositories/manager-permissions.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/app/api/cash-accounts/route.ts"),
  import("../../src/app/api/cash-accounts/[accountId]/opening/route.ts"),
  import("../../src/app/api/expenses/route.ts"),
]);

test("cash accounts open once and account-backed expenses reduce verified funds", async () => {
  const pool = getDatabasePool();
  const unique = String(Date.now());
  const businessIds = [];
  const sessionHashes = [];
  const cookieName = authSessionCookieName();
  const originHeaders = { Origin: "http://localhost:3000", "Content-Type": "application/json" };
  let businessId;
  let adminToken;

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
      const business = await createBusiness(client, { name: `Ledger ${unique}` });
      businessId = business.id;
      businessIds.push(business.id);
      const admin = await createAdminUser(client, {
        businessId: business.id,
        username: `ledger.admin.${unique.slice(-8)}`,
        fullName: "Ledger Admin",
        email: `ledger-admin-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [admin.id]);
      await seedDefaultManagerPermissions(client, business.id);
      await client.query(
        `UPDATE business_manager_permissions
         SET enabled = TRUE
         WHERE business_id = $1 AND permission_id IN (
           'cash_accounts.balance.read','cash_accounts.manage','expenses.read','expenses.manage'
         )`,
        [business.id],
      );
      for (const [userId, token] of [
        [admin.id, createOpaqueToken()],
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
      }
    });

    const created = await postAccount(request("/api/cash-accounts", adminToken, {
      method: "POST",
      body: JSON.stringify({ branchId: null, accountType: "bank", name: "Main bank" }),
    }));
    assert.equal(created.status, 201);
    const account = (await created.json()).account;

    const opening = await postOpening(
      request(`/api/cash-accounts/${account.id}/opening`, adminToken, {
        method: "POST",
        body: JSON.stringify({ openingAmount: 100000 }),
      }),
      { params: Promise.resolve({ accountId: account.id }) },
    );
    assert.equal(opening.status, 201);
    assert.equal((await opening.json()).account.available_balance, 100000);

    const expense = await postExpense(request("/api/expenses", adminToken, {
      method: "POST",
      body: JSON.stringify({
        branchId: null,
        category: "rent",
        amount: 25000,
        expenseDate: new Date().toISOString().slice(0, 10),
        paymentMethod: "bank_transfer",
        cashAccountId: account.id,
        description: "Monthly rent",
        responsibleName: "Ledger Admin",
      }),
    }));
    assert.equal(expense.status, 201);

    const accounts = await getAccounts(request("/api/cash-accounts", adminToken));
    assert.equal(accounts.status, 200);
    assert.equal((await accounts.json()).accounts[0].available_balance, 75000);

    const insufficient = await postExpense(request("/api/expenses", adminToken, {
      method: "POST",
      body: JSON.stringify({
        category: "other",
        amount: 75001,
        expenseDate: new Date().toISOString().slice(0, 10),
        paymentMethod: "bank_transfer",
        cashAccountId: account.id,
        description: "Too much",
        responsibleName: "Ledger Admin",
      }),
    }));
    assert.equal(insufficient.status, 400);

    const history = await getExpenses(request("/api/expenses?offset=0&limit=20", adminToken));
    assert.equal(history.status, 200);
    assert.equal((await history.json()).total_count, 1);
  } finally {
    if (sessionHashes.length) {
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = ANY($1::bytea[])", [sessionHashes]);
    }
    for (const businessId of businessIds) {
      await pool.query("DELETE FROM audit_logs WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_movements WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM expenses WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_account_openings WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_accounts WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM business_manager_permissions WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
    await pool.end();
  }
});
