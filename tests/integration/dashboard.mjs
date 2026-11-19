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
  { GET: getDashboard },
  { GET: getDashboardBranches },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/repositories/branches.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/repositories/manager-permissions.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/app/api/dashboard/route.ts"),
  import("../../src/app/api/dashboard/branches/route.ts"),
]);

test("dashboard returns branch-scoped inventory summary and Manager branch only", async () => {
  const pool = getDatabasePool();
  const unique = String(Date.now());
  const businessIds = [];
  const sessionHashes = [];
  const cookieName = authSessionCookieName();
  let businessId;
  let branchId;
  let adminToken;
  let managerToken;

  function request(path, token) {
    return new NextRequest(`http://localhost:3000${path}`, {
      headers: { Cookie: `${cookieName}=${token}` },
    });
  }

  try {
    await withTransaction(async (client) => {
      const business = await createBusiness(client, { name: `Dashboard ${unique}` });
      businessId = business.id;
      businessIds.push(business.id);
      const admin = await createAdminUser(client, {
        businessId: business.id,
        username: `dashboard.admin.${unique.slice(-8)}`,
        fullName: "Dashboard Admin",
        email: `dashboard-admin-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [admin.id]);
      const branch = await createBranch(client, business.id, { name: "Dashboard Main" }, true);
      const other = await createBranch(client, business.id, { name: "Dashboard Other" }, true);
      branchId = branch.id;
      const manager = await createManagerUser(client, {
        businessId: business.id,
        branchId: branch.id,
        username: `dashboard.manager.${unique.slice(-8)}`,
        fullName: "Dashboard Manager",
        passwordHash: "$argon2id$integration-test",
      });
      await seedDefaultManagerPermissions(client, business.id);
      await client.query(
        `UPDATE business_manager_permissions
         SET enabled = TRUE
         WHERE business_id = $1 AND permission_id IN ('inventory.read')`,
        [business.id],
      );

      const unit = await client.query(`SELECT id FROM units WHERE code = 'pc'`);
      const product = await client.query(
        `INSERT INTO products
           (business_id, name, sku, base_unit_id, purchase_price, selling_price, min_stock_quantity)
         VALUES ($1, $2, $3, $4, 8000, 12000, 5000)
         RETURNING id`,
        [business.id, "Dashboard Cement", `DASH-${unique.slice(-8)}`, unit.rows[0].id],
      );
      await client.query(
        `INSERT INTO inventory_balances
           (business_id, branch_id, product_id, quantity_on_hand, average_unit_cost)
         VALUES ($1, $2, $3, 3000, 8000)`,
        [business.id, branch.id, product.rows[0].id],
      );
      await client.query(
        `INSERT INTO inventory_cost_layers
           (business_id, branch_id, product_id, source_type, quantity_received, quantity_remaining, unit_cost)
         VALUES ($1, $2, $3, 'opening_stock', 3000, 3000, 8000)`,
        [business.id, branch.id, product.rows[0].id],
      );
      await client.query(
        `INSERT INTO inventory_balances
           (business_id, branch_id, product_id, quantity_on_hand, average_unit_cost)
         VALUES ($1, $2, $3, 9000, 8000)`,
        [business.id, other.id, product.rows[0].id],
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

    const adminResponse = await getDashboard(
      request(`/api/dashboard?branchId=${branchId}`, adminToken),
    );
    assert.equal(adminResponse.status, 200);
    const data = await adminResponse.json();
    assert.equal(data.branch.id, branchId);
    assert.equal(data.inventory.total_count, 1);
    assert.equal(data.inventory.total_stock_value, 24000);
    assert.equal(data.inventory.low_stock_count, 1);
    assert.equal(data.inventory.out_of_stock_count, 0);
    assert.equal(data.inventory.items[0].quantity_on_hand, 3000);

    const managerBranches = await getDashboardBranches(
      request("/api/dashboard/branches", managerToken),
    );
    assert.equal(managerBranches.status, 200);
    assert.equal((await managerBranches.json()).branches.length, 1);

    const managerData = await getDashboard(
      request(`/api/dashboard?branchId=${branchId}`, managerToken),
    );
    assert.equal(managerData.status, 200);
  } finally {
    if (sessionHashes.length) {
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = ANY($1::bytea[])", [sessionHashes]);
    }
    for (const businessId of businessIds) {
      await pool.query("DELETE FROM inventory_cost_layers WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM inventory_balances WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM products WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM business_manager_permissions WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM branches WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
    await pool.end();
  }
});
