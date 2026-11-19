import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for the PostgreSQL integration test.");
}
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
  { GET: getInventoryBranches },
  { GET: getInventory },
  { GET: getStockMovements },
  { POST: postOpeningStock },
  { POST: postStockCorrection },
  { POST: postStockReceipt },
  { POST: postProduct },
  { PATCH: patchProductSellingPrice },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/repositories/branches.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/repositories/manager-permissions.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/app/api/inventory/branches/route.ts"),
  import("../../src/app/api/inventory/route.ts"),
  import("../../src/app/api/inventory/[productId]/movements/route.ts"),
  import("../../src/app/api/inventory/[productId]/opening-stock/route.ts"),
  import("../../src/app/api/inventory/[productId]/correction/route.ts"),
  import("../../src/app/api/inventory/[productId]/receipts/route.ts"),
  import("../../src/app/api/products/route.ts"),
  import("../../src/app/api/products/[productId]/selling-price/route.ts"),
]);

test("branch inventory enforces scope, FIFO cost layers, price floors, and movement audit", async () => {
  const pool = getDatabasePool();
  const businessIds = [];
  const sessionHashes = [];
  const unique = String(Date.now());
  const cookieName = authSessionCookieName();
  const originHeaders = {
    Origin: "http://localhost:3000",
    "Content-Type": "application/json",
  };
  let businessId;
  let firstBranchId;
  let secondBranchId;
  let adminToken;
  let firstManagerToken;
  let secondManagerToken;
  let productId;

  function authenticatedRequest(path, token, options = {}) {
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
      const business = await createBusiness(client, { name: `Inventory test ${unique}` });
      businessId = business.id;
      businessIds.push(business.id);
      const admin = await createAdminUser(client, {
        businessId: business.id,
        username: `inventory.admin.${unique.slice(-8)}`,
        fullName: "Inventory Admin",
        email: `inventory-admin-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query(
        "UPDATE users SET email_verified_at = now() WHERE business_id = $1 AND id = $2",
        [business.id, admin.id],
      );
      const firstBranch = await createBranch(client, business.id, { name: "Inventory branch one" }, true);
      const secondBranch = await createBranch(client, business.id, { name: "Inventory branch two" }, true);
      firstBranchId = firstBranch.id;
      secondBranchId = secondBranch.id;
      const firstManager = await createManagerUser(client, {
        businessId: business.id,
        branchId: firstBranch.id,
        username: `inventory.manager.one.${unique.slice(-8)}`,
        fullName: "Inventory Manager One",
        passwordHash: "$argon2id$integration-test",
      });
      const secondManager = await createManagerUser(client, {
        businessId: business.id,
        branchId: secondBranch.id,
        username: `inventory.manager.two.${unique.slice(-8)}`,
        fullName: "Inventory Manager Two",
        passwordHash: "$argon2id$integration-test",
      });
      await seedDefaultManagerPermissions(client, business.id);
      await client.query(
        `UPDATE business_manager_permissions
         SET enabled = TRUE
         WHERE business_id = $1
           AND permission_id IN ('inventory.read', 'inventory.manage', 'catalog.manage')`,
        [business.id],
      );

      for (const [userId, token] of [
        [admin.id, createOpaqueToken()],
        [firstManager.id, createOpaqueToken()],
        [secondManager.id, createOpaqueToken()],
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
        if (userId === firstManager.id) firstManagerToken = token;
        if (userId === secondManager.id) secondManagerToken = token;
      }
    });

    const unauthenticatedResponse = await getInventory(
      new NextRequest("http://localhost:3000/api/inventory"),
    );
    assert.equal(unauthenticatedResponse.status, 401);

    const branchOptions = await getInventoryBranches(
      authenticatedRequest("/api/inventory/branches", adminToken),
    );
    assert.equal(branchOptions.status, 200);
    assert.equal((await branchOptions.json()).branches.length, 2);
    const managerBranches = await getInventoryBranches(
      authenticatedRequest("/api/inventory/branches", firstManagerToken),
    );
    assert.equal(managerBranches.status, 200);
    assert.deepEqual(
      (await managerBranches.json()).branches.map((branch) => branch.id),
      [firstBranchId],
    );

    const productResponse = await postProduct(
      authenticatedRequest("/api/products", adminToken, {
        method: "POST",
        body: JSON.stringify({
          name: "Branch stock item",
          sku: `branch-stock-${unique}`,
          baseUnitId: "00000000-0000-4000-8000-000000000002",
          purchasePrice: 10000,
          sellingPrice: 15000,
          minStockQuantity: 1000,
          vatClass: "standard",
        }),
      }),
    );
    assert.equal(productResponse.status, 201);
    const product = (await productResponse.json()).product;
    productId = product.id;

    const emptyInventory = await getInventory(
      authenticatedRequest(`/api/inventory?branchId=${firstBranchId}`, adminToken),
    );
    assert.equal(emptyInventory.status, 200);
    const emptyPage = await emptyInventory.json();
    assert.equal(emptyPage.items[0].quantity_on_hand, 0);
    assert.equal(emptyPage.items[0].stock_value, 0);
    assert.equal(emptyPage.items[0].minimum_selling_price, 10000);

    const wrongBranchRead = await getInventory(
      authenticatedRequest(`/api/inventory?branchId=${secondBranchId}`, firstManagerToken),
    );
    assert.equal(wrongBranchRead.status, 403);

    const openingResponse = await postOpeningStock(
      authenticatedRequest(`/api/inventory/${product.id}/opening-stock`, firstManagerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId: firstBranchId,
          quantity: 5000,
          reason: "Initial branch count",
        }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(openingResponse.status, 201);
    const openingMovement = (await openingResponse.json()).movement;
    assert.equal(openingMovement.user_id !== null, true);
    assert.equal(openingMovement.new_quantity, 5000);

    const repeatedOpening = await postOpeningStock(
      authenticatedRequest(`/api/inventory/${product.id}/opening-stock`, firstManagerToken, {
        method: "POST",
        body: JSON.stringify({ branchId: firstBranchId, quantity: 1000 }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(repeatedOpening.status, 409);

    const secondBranchOpening = await postOpeningStock(
      authenticatedRequest(`/api/inventory/${product.id}/opening-stock`, adminToken, {
        method: "POST",
        body: JSON.stringify({ branchId: secondBranchId, quantity: 2000 }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(secondBranchOpening.status, 201);

    const wrongBranchWrite = await postStockCorrection(
      authenticatedRequest(`/api/inventory/${product.id}/correction`, firstManagerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId: secondBranchId,
          targetQuantity: 1000,
          reason: "Should not cross branches",
        }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(wrongBranchWrite.status, 403);

    const fractionalCorrection = await postStockCorrection(
      authenticatedRequest(`/api/inventory/${product.id}/correction`, firstManagerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId: firstBranchId,
          targetQuantity: 4500,
          reason: "Fractional count for whole-unit product",
        }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(fractionalCorrection.status, 400);

    const correctionResponse = await postStockCorrection(
      authenticatedRequest(`/api/inventory/${product.id}/correction`, firstManagerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId: firstBranchId,
          targetQuantity: 3000,
          reason: "Physical count discrepancy",
        }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(correctionResponse.status, 201);
    const correctionMovement = (await correctionResponse.json()).movement;
    assert.equal(correctionMovement.quantity_delta, -2000);
    assert.equal(correctionMovement.unit_cost, 10000);
    assert.equal(correctionMovement.total_cost, 20000);

    const receiptWithLowPrice = await postStockReceipt(
      authenticatedRequest(`/api/inventory/${product.id}/receipts`, firstManagerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId: firstBranchId,
          quantity: 1000,
          receivedUnitCost: 12000,
          receiptReference: `LOW-${unique}`,
          newSellingPrice: 11999,
        }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(receiptWithLowPrice.status, 400);

    const receiptResponse = await postStockReceipt(
      authenticatedRequest(`/api/inventory/${product.id}/receipts`, firstManagerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId: firstBranchId,
          quantity: 1000,
          receivedUnitCost: 12000,
          receiptReference: `DEL-${unique}`,
          reason: "Delivery received in branch one",
          newSellingPrice: 13000,
        }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(receiptResponse.status, 201);

    const belowCostPriceResponse = await patchProductSellingPrice(
      authenticatedRequest(`/api/products/${product.id}/selling-price`, adminToken, {
        method: "PATCH",
        body: JSON.stringify({ sellingPrice: 11999 }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(belowCostPriceResponse.status, 400);

    const branchOneInventory = await getInventory(
      authenticatedRequest(`/api/inventory?branchId=${firstBranchId}`, adminToken),
    );
    const branchOnePage = await branchOneInventory.json();
    assert.equal(branchOnePage.items[0].quantity_on_hand, 4000);
    assert.equal(branchOnePage.items[0].stock_value, 42000);
    assert.equal(branchOnePage.items[0].minimum_selling_price, 12000);
    assert.equal(branchOnePage.items[0].selling_price, 13000);
    assert.equal(branchOnePage.total_stock_value, 42000);

    const branchTwoInventory = await getInventory(
      authenticatedRequest(`/api/inventory?branchId=${secondBranchId}`, adminToken),
    );
    const branchTwoPage = await branchTwoInventory.json();
    assert.equal(branchTwoPage.items[0].quantity_on_hand, 2000);
    assert.equal(branchTwoPage.items[0].stock_value, 20000);

    const fifoCorrectionResponse = await postStockCorrection(
      authenticatedRequest(`/api/inventory/${product.id}/correction`, firstManagerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId: firstBranchId,
          targetQuantity: 2000,
          reason: "FIFO valuation check",
        }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(fifoCorrectionResponse.status, 201);
    const fifoMovement = (await fifoCorrectionResponse.json()).movement;
    assert.equal(fifoMovement.quantity_delta, -2000);
    assert.equal(fifoMovement.unit_cost, 10000);
    assert.equal(fifoMovement.total_cost, 20000);

    const movementResponse = await getStockMovements(
      authenticatedRequest(
        `/api/inventory/${product.id}/movements?branchId=${firstBranchId}&offset=0&limit=20`,
        firstManagerToken,
      ),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(movementResponse.status, 200);
    const movements = (await movementResponse.json()).movements;
    assert.equal(movements.length, 4);
    assert.equal(movements[0].movement_type, "stock_correction");
    assert.equal(movements[0].branch_id, firstBranchId);
    assert.equal(movements[1].movement_type, "purchase_received");
    assert.equal(movements[2].movement_type, "stock_correction");
    assert.equal(movements[3].movement_type, "opening_stock");

    const wrongBranchHistory = await getStockMovements(
      authenticatedRequest(
        `/api/inventory/${product.id}/movements?branchId=${secondBranchId}`,
        firstManagerToken,
      ),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(wrongBranchHistory.status, 403);

    const branchTwoHistory = await getStockMovements(
      authenticatedRequest(
        `/api/inventory/${product.id}/movements?branchId=${secondBranchId}`,
        adminToken,
      ),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal((await branchTwoHistory.json()).movements.length, 1);

    await pool.query(
      `UPDATE business_manager_permissions
       SET enabled = FALSE
       WHERE business_id = $1 AND permission_id = 'inventory.manage'`,
      [businessId],
    );
    const readOnlyWrite = await postStockCorrection(
      authenticatedRequest(`/api/inventory/${product.id}/correction`, secondManagerToken, {
        method: "POST",
        body: JSON.stringify({
          branchId: secondBranchId,
          targetQuantity: 1000,
          reason: "Permission enforcement check",
        }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(readOnlyWrite.status, 403);

    const auditResult = await pool.query(
      `SELECT action
       FROM audit_logs
       WHERE business_id = $1
         AND action IN (
           'inventory.opening_stock_recorded',
           'inventory.stock_corrected',
           'inventory.stock_received',
           'catalog.product_base_selling_price_updated'
         )
       ORDER BY action`,
      [businessId],
    );
    assert.equal(
      auditResult.rows.filter((row) => row.action === "inventory.opening_stock_recorded").length,
      2,
    );
    assert.equal(
      auditResult.rows.filter((row) => row.action === "inventory.stock_corrected").length,
      2,
    );
    assert.equal(
      auditResult.rows.filter((row) => row.action === "inventory.stock_received").length,
      1,
    );
    assert.equal(
      auditResult.rows.filter((row) => row.action === "catalog.product_base_selling_price_updated").length,
      1,
    );
  } finally {
    if (sessionHashes.length > 0) {
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = ANY($1::bytea[])", [sessionHashes]);
    }
    for (const currentBusinessId of businessIds) {
      if (productId) {
        await pool.query("DELETE FROM products WHERE business_id = $1 AND id = $2", [currentBusinessId, productId]);
      }
      await pool.query("DELETE FROM audit_logs WHERE business_id = $1", [currentBusinessId]);
      await pool.query("DELETE FROM business_manager_permissions WHERE business_id = $1", [currentBusinessId]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [currentBusinessId]);
      await pool.query("DELETE FROM branches WHERE business_id = $1", [currentBusinessId]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [currentBusinessId]);
    }
    await pool.end();
  }
});
