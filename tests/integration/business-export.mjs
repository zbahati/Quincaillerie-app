import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required.");
process.env.DATABASE_URL = testDatabaseUrl;

const [
  { getDatabasePool },
  { withTransaction },
  { createBusiness },
  { createBranch },
  { createAdminUser, createManagerUser },
  { createAuthSession },
  { createOpaqueToken, hashOpaqueToken, authSessionCookieName },
  { GET: exportBusinessData },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/repositories/branches.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/app/api/settings/business/export/route.ts"),
]);

test("business data export is Admin-only, tenant-scoped, and excludes authentication secrets", async () => {
  const pool = getDatabasePool();
  const unique = String(Date.now());
  const businessIds = [];
  const sessionHashes = [];
  const cookieName = authSessionCookieName();
  let businessId;
  let adminToken;
  let managerToken;

  function request(token) {
    return new NextRequest("http://localhost:3000/api/settings/business/export", {
      headers: token ? { Cookie: `${cookieName}=${token}` } : {},
    });
  }

  try {
    await withTransaction(async (client) => {
      const business = await createBusiness(client, { name: `Export test ${unique}` });
      businessId = business.id;
      businessIds.push(business.id);
      const admin = await createAdminUser(client, {
        businessId,
        username: `export.admin.${unique.slice(-8)}`,
        fullName: "Export Admin",
        email: `export-${unique}@example.test`,
        passwordHash: "$argon2id$must-not-be-exported",
      });
      await client.query(
        "UPDATE users SET email_verified_at = now() WHERE business_id = $1 AND id = $2",
        [businessId, admin.id],
      );
      const branch = await createBranch(client, businessId, { name: "Export branch" });
      const manager = await createManagerUser(client, {
        businessId,
        branchId: branch.id,
        username: `export.manager.${unique.slice(-8)}`,
        fullName: "Export Manager",
        passwordHash: "$argon2id$manager-hash-must-not-be-exported",
      });
      const other = await createBusiness(client, { name: `Other export test ${unique}` });
      businessIds.push(other.id);
      const otherAdmin = await createAdminUser(client, {
        businessId: other.id,
        username: `other.admin.${unique.slice(-8)}`,
        fullName: "Other Business Admin",
        email: `other-export-${unique}@example.test`,
        passwordHash: "$argon2id$other-business-hash",
      });
      const otherBranch = await createBranch(client, other.id, { name: "Other export branch" });
      const otherSupplier = await client.query(
        `INSERT INTO suppliers (business_id, name)
         VALUES ($1, 'Other Export Supplier') RETURNING id`,
        [other.id],
      );
      const otherPurchase = await client.query(
        `INSERT INTO purchases
           (business_id, branch_id, supplier_id, supplier_invoice_number, status, subtotal)
         VALUES ($1, $2, $3, $4, 'received', 900)
         RETURNING id`,
        [other.id, otherBranch.id, otherSupplier.rows[0].id, `OTHER-EXPORT-PURCHASE-${unique}`],
      );
      const otherAccount = await client.query(
        `INSERT INTO cash_accounts (business_id, branch_id, account_type, name)
         VALUES ($1, $2, 'cash_drawer', 'Other export cash')
         RETURNING id`,
        [other.id, otherBranch.id],
      );
      await client.query(
        `INSERT INTO cash_account_openings
           (business_id, account_id, opening_amount, entered_by_user_id, authorized_by_user_id)
         VALUES ($1, $2, 1000, $3, $3)`,
        [other.id, otherAccount.rows[0].id, otherAdmin.id],
      );
      const otherPayment = await client.query(
        `INSERT INTO purchase_payments
           (business_id, purchase_id, payment_method, amount, cash_account_id)
         VALUES ($1, $2, 'cash', 900, $3)
         RETURNING id`,
        [other.id, otherPurchase.rows[0].id, otherAccount.rows[0].id],
      );
      await client.query(
        `INSERT INTO cash_movements
           (business_id, account_id, movement_type, direction, amount, source_type, source_id)
         VALUES ($1, $2, 'supplier_payment', 'out', 900, 'purchase_payment', $3)`,
        [other.id, otherAccount.rows[0].id, otherPayment.rows[0].id],
      );

      const unit = await client.query("SELECT id FROM units WHERE code = 'pc'");
      await client.query(
        `INSERT INTO products
           (business_id, name, sku, base_unit_id, purchase_price, selling_price)
         VALUES ($1, 'Export Product', $2, $3, 9007199254740993, 12000)`,
        [businessId, `EXP-${unique.slice(-8)}`, unit.rows[0].id],
      );
      const supplier = await client.query(
        `INSERT INTO suppliers (business_id, name)
         VALUES ($1, 'Export Supplier') RETURNING id`,
        [businessId],
      );
      const purchase = await client.query(
        `INSERT INTO purchases
           (business_id, branch_id, supplier_id, supplier_invoice_number, status, subtotal)
         VALUES ($1, $2, $3, $4, 'received', 700)
         RETURNING id`,
        [businessId, branch.id, supplier.rows[0].id, `EXPORT-PURCHASE-${unique}`],
      );
      const account = await client.query(
        `INSERT INTO cash_accounts (business_id, branch_id, account_type, name)
         VALUES ($1, $2, 'cash_drawer', 'Export cash')
         RETURNING id`,
        [businessId, branch.id],
      );
      await client.query(
        `INSERT INTO cash_account_openings
           (business_id, account_id, opening_amount, entered_by_user_id, authorized_by_user_id)
         VALUES ($1, $2, 1000, $3, $3)`,
        [businessId, account.rows[0].id, admin.id],
      );
      const payment = await client.query(
        `INSERT INTO purchase_payments
           (business_id, purchase_id, payment_method, amount, cash_account_id)
         VALUES ($1, $2, 'cash', 700, $3)
         RETURNING id`,
        [businessId, purchase.rows[0].id, account.rows[0].id],
      );
      await client.query(
        `INSERT INTO cash_movements
           (business_id, account_id, movement_type, direction, amount, source_type, source_id)
         VALUES ($1, $2, 'supplier_payment', 'out', 700, 'purchase_payment', $3)`,
        [businessId, account.rows[0].id, payment.rows[0].id],
      );

      for (const [userId, token, assign] of [
        [admin.id, createOpaqueToken(), "admin"],
        [manager.id, createOpaqueToken(), "manager"],
      ]) {
        const tokenHash = hashOpaqueToken(token);
        sessionHashes.push(tokenHash);
        await createAuthSession(client, {
          businessId,
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        });
        if (assign === "admin") adminToken = token;
        else managerToken = token;
      }
    });

    const unauthenticated = await exportBusinessData(request(null));
    assert.equal(unauthenticated.status, 401);

    const managerResponse = await exportBusinessData(request(managerToken));
    assert.equal(managerResponse.status, 403);

    const response = await exportBusinessData(request(adminToken));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition") ?? "", /attachment; filename="quincaillerie-Export-test-/);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const text = await response.text();
    const exportFile = JSON.parse(text);
    assert.equal(exportFile.format, "quincaillerie-business-export");
    assert.equal(exportFile.version, 1);
    assert.equal(exportFile.scope, "business");
    assert.equal(exportFile.businessId, businessId);
    assert.equal(exportFile.data.businesses.length, 1);
    assert.equal(exportFile.data.branches.length, 1);
    assert.equal(exportFile.data.products.length, 1);
    assert.equal(exportFile.data.purchase_payments.length, 1);
    assert.equal(exportFile.data.purchase_payments[0].amount, "700");
    assert.equal(exportFile.data.products[0].purchase_price, "9007199254740993");
    assert.ok(exportFile.data.users.every((user) => !("password_hash" in user)));
    assert.equal(exportFile.data.audit_logs.some((entry) => entry.action === "business.data_exported"), true);
    assert.equal(text.includes("must-not-be-exported"), false);
    assert.equal(text.includes(adminToken), false);
    assert.equal(text.includes(managerToken), false);
    assert.equal(text.includes(`Other export test ${unique}`), false);
    assert.equal(text.includes("other.admin."), false);
    assert.equal("auth_sessions" in exportFile.data, false);
    assert.equal("admin_email_verification_tokens" in exportFile.data, false);
    assert.ok(exportFile.excludes.includes("authentication sessions"));
    assert.ok(exportFile.excludes.includes("password hashes"));
  } finally {
    if (sessionHashes.length) {
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = ANY($1::bytea[])", [sessionHashes]);
    }
    for (const id of businessIds) {
      await pool.query("DELETE FROM audit_logs WHERE business_id = $1", [id]);
      await pool.query("DELETE FROM cash_movements WHERE business_id = $1", [id]);
      await pool.query("DELETE FROM purchase_payments WHERE business_id = $1", [id]);
      await pool.query("DELETE FROM cash_account_openings WHERE business_id = $1", [id]);
      await pool.query("DELETE FROM cash_accounts WHERE business_id = $1", [id]);
      await pool.query("DELETE FROM purchases WHERE business_id = $1", [id]);
      await pool.query("DELETE FROM suppliers WHERE business_id = $1", [id]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [id]);
      await pool.query("DELETE FROM branches WHERE business_id = $1", [id]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [id]);
    }
    await pool.end();
  }
});
