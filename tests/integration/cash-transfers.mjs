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
  { createAdminUser },
  { seedDefaultManagerPermissions },
  { createAuthSession },
  { createOpaqueToken, hashOpaqueToken, authSessionCookieName },
  { GET: getAccounts, POST: postAccount },
  { POST: postOpening },
  { GET: getTransfers, POST: postTransfer },
  { POST: postConfirm },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/repositories/branches.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/repositories/manager-permissions.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/app/api/cash-accounts/route.ts"),
  import("../../src/app/api/cash-accounts/[accountId]/opening/route.ts"),
  import("../../src/app/api/cash-transfers/route.ts"),
  import("../../src/app/api/cash-transfers/[transferId]/confirm/route.ts"),
]);

test("cash transfers remain pending until Admin confirmation", async () => {
  const pool = getDatabasePool();
  const unique = String(Date.now());
  const businessIds = [];
  const sessionHashes = [];
  const cookieName = authSessionCookieName();
  const originHeaders = { Origin: "http://localhost:3000", "Content-Type": "application/json" };
  let branchId;
  let secondaryBranchId;
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
      const business = await createBusiness(client, { name: `Transfer ${unique}` });
      branchId = (await createBranch(client, business.id, { name: "Transfer main" }, true)).id;
      secondaryBranchId = (await createBranch(client, business.id, { name: "Transfer secondary" }, true)).id;
      businessIds.push(business.id);
      const admin = await createAdminUser(client, {
        businessId: business.id,
        username: `transfer.admin.${unique.slice(-8)}`,
        fullName: "Transfer Admin",
        email: `transfer-admin-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [admin.id]);
      await seedDefaultManagerPermissions(client, business.id);
      await client.query(
        `UPDATE business_manager_permissions
         SET enabled = TRUE
         WHERE business_id = $1 AND permission_id IN ('cash_accounts.balance.read','cash_accounts.manage')`,
        [business.id],
      );
      const token = createOpaqueToken();
      adminToken = token;
      const tokenHash = hashOpaqueToken(token);
      sessionHashes.push(tokenHash);
      await createAuthSession(client, {
        businessId: business.id,
        userId: admin.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
      });
    });

    const sourceResponse = await postAccount(request("/api/cash-accounts", adminToken, {
      method: "POST",
      body: JSON.stringify({ branchId, accountType: "bank", name: "Source bank" }),
    }));
    assert.equal(sourceResponse.status, 201);
    const source = (await sourceResponse.json()).account;
    const destinationResponse = await postAccount(request("/api/cash-accounts", adminToken, {
      method: "POST",
      body: JSON.stringify({ branchId, accountType: "mtn_wallet", name: "Destination wallet" }),
    }));
    assert.equal(destinationResponse.status, 201);
    const destination = (await destinationResponse.json()).account;
    const secondaryResponse = await postAccount(request("/api/cash-accounts", adminToken, {
      method: "POST",
      body: JSON.stringify({ branchId: secondaryBranchId, accountType: "bank", name: "Secondary bank" }),
    }));
    assert.equal(secondaryResponse.status, 201);
    const secondaryAccount = (await secondaryResponse.json()).account;

    await postOpening(request(`/api/cash-accounts/${source.id}/opening`, adminToken, {
      method: "POST",
      body: JSON.stringify({ openingAmount: 100000 }),
    }), { params: Promise.resolve({ accountId: source.id }) });
    await postOpening(request(`/api/cash-accounts/${destination.id}/opening`, adminToken, {
      method: "POST",
      body: JSON.stringify({ openingAmount: 20000 }),
    }), { params: Promise.resolve({ accountId: destination.id }) });
    await postOpening(request(`/api/cash-accounts/${secondaryAccount.id}/opening`, adminToken, {
      method: "POST",
      body: JSON.stringify({ openingAmount: 50000 }),
    }), { params: Promise.resolve({ accountId: secondaryAccount.id }) });

    const createResponse = await postTransfer(request("/api/cash-transfers", adminToken, {
      method: "POST",
      body: JSON.stringify({ branchId, fromAccountId: source.id, toAccountId: destination.id, amount: 30000 }),
    }));
    assert.equal(createResponse.status, 201);
    const transfer = (await createResponse.json()).transfer;
    assert.equal(transfer.status, "pending");

    const pendingAccounts = await getAccounts(request(`/api/cash-accounts?branchId=${branchId}`, adminToken));
    const pending = (await pendingAccounts.json()).accounts;
    assert.equal(pending.length, 2);
    assert.equal(pending.find((account) => account.id === source.id).available_balance, 100000);
    assert.equal(pending.find((account) => account.id === destination.id).available_balance, 20000);

    const insufficient = await postTransfer(request("/api/cash-transfers", adminToken, {
      method: "POST",
      body: JSON.stringify({ branchId, fromAccountId: source.id, toAccountId: destination.id, amount: 100001 }),
    }));
    assert.equal(insufficient.status, 400);
    const crossBranchTransfer = await postTransfer(request("/api/cash-transfers", adminToken, {
      method: "POST",
      body: JSON.stringify({ branchId, fromAccountId: source.id, toAccountId: secondaryAccount.id, amount: 1000 }),
    }));
    assert.equal(crossBranchTransfer.status, 400);
    const secondaryAccounts = await getAccounts(
      request(`/api/cash-accounts?branchId=${secondaryBranchId}`, adminToken),
    );
    assert.deepEqual((await secondaryAccounts.json()).accounts.map((account) => account.id), [secondaryAccount.id]);

    const confirmResponse = await postConfirm(
      request(`/api/cash-transfers/${transfer.id}/confirm`, adminToken, {
        method: "POST",
        body: JSON.stringify({ branchId, confirmationReference: "AUTH-001" }),
      }),
      { params: Promise.resolve({ transferId: transfer.id }) },
    );
    assert.equal(confirmResponse.status, 200);
    assert.equal((await confirmResponse.json()).transfer.status, "confirmed");

    const confirmedAccounts = await getAccounts(request(`/api/cash-accounts?branchId=${branchId}`, adminToken));
    const confirmed = (await confirmedAccounts.json()).accounts;
    assert.equal(confirmed.find((account) => account.id === source.id).available_balance, 70000);
    assert.equal(confirmed.find((account) => account.id === destination.id).available_balance, 50000);

    const history = await getTransfers(request(`/api/cash-transfers?branchId=${branchId}`, adminToken));
    assert.equal(history.status, 200);
    assert.equal((await history.json()).transfers[0].status, "confirmed");
  } finally {
    if (sessionHashes.length) {
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = ANY($1::bytea[])", [sessionHashes]);
    }
    for (const businessId of businessIds) {
      await pool.query("DELETE FROM audit_logs WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_movements WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM cash_transfers WHERE business_id = $1", [businessId]);
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
