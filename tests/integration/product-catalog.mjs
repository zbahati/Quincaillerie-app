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
  { GET: getCategories, POST: postCategory },
  { GET: getBrands, POST: postBrand },
  { GET: getProducts, POST: postProduct },
  { GET: getProductUnits, POST: postProductUnit },
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
  import("../../src/app/api/catalog/categories/route.ts"),
  import("../../src/app/api/catalog/brands/route.ts"),
  import("../../src/app/api/products/route.ts"),
  import("../../src/app/api/products/[productId]/units/route.ts"),
  import("../../src/app/api/products/[productId]/selling-price/route.ts"),
]);

test("product catalogue preserves business scope, permissions, unit conversions, and price history", async () => {
  const pool = getDatabasePool();
  const businessIds = [];
  const sessionHashes = [];
  const unique = String(Date.now());
  const cookieName = authSessionCookieName();
  const originHeaders = {
    Origin: "http://localhost:3000",
    "Content-Type": "application/json",
  };
  let businessOneId;
  let managerId;
  let adminOneToken;
  let managerToken;
  let adminTwoToken;

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
      const businessOne = await createBusiness(client, { name: `Product test ${unique}` });
      businessOneId = businessOne.id;
      businessIds.push(businessOne.id);
      const adminOne = await createAdminUser(client, {
        businessId: businessOne.id,
        username: `product.admin.${unique.slice(-8)}`,
        fullName: "Product Admin",
        email: `product-admin-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query(
        "UPDATE users SET email_verified_at = now() WHERE business_id = $1 AND id = $2",
        [businessOne.id, adminOne.id],
      );
      const branch = await createBranch(client, businessOne.id, { name: "Product branch" }, true);
      const manager = await createManagerUser(client, {
        businessId: businessOne.id,
        branchId: branch.id,
        username: `product.manager.${unique.slice(-8)}`,
        fullName: "Product Manager",
        passwordHash: "$argon2id$integration-test",
      });
      managerId = manager.id;
      await seedDefaultManagerPermissions(client, businessOne.id);
      await client.query(
        `UPDATE business_manager_permissions
         SET enabled = TRUE
         WHERE business_id = $1 AND permission_id IN ('catalog.read', 'catalog.manage')`,
        [businessOne.id],
      );

      const businessTwo = await createBusiness(client, { name: `Other product ${unique}` });
      businessIds.push(businessTwo.id);
      const adminTwo = await createAdminUser(client, {
        businessId: businessTwo.id,
        username: `product.other.${unique.slice(-8)}`,
        fullName: "Other Product Admin",
        email: `product-other-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query(
        "UPDATE users SET email_verified_at = now() WHERE business_id = $1 AND id = $2",
        [businessTwo.id, adminTwo.id],
      );

      for (const [userId, token, businessId] of [
        [adminOne.id, createOpaqueToken(), businessOne.id],
        [manager.id, createOpaqueToken(), businessOne.id],
        [adminTwo.id, createOpaqueToken(), businessTwo.id],
      ]) {
        const tokenHash = hashOpaqueToken(token);
        sessionHashes.push(tokenHash);
        await createAuthSession(client, {
          businessId,
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        });
        if (userId === adminOne.id) adminOneToken = token;
        if (userId === manager.id) managerToken = token;
        if (userId === adminTwo.id) adminTwoToken = token;
      }
    });

    const categoryOneResponse = await postCategory(
      authenticatedRequest("/api/catalog/categories", adminOneToken, {
        method: "POST",
        body: JSON.stringify({ name: `Hardware ${unique}` }),
      }),
    );
    assert.equal(categoryOneResponse.status, 201);
    const categoryOne = (await categoryOneResponse.json()).category;

    const categoryTwoResponse = await postCategory(
      authenticatedRequest("/api/catalog/categories", adminTwoToken, {
        method: "POST",
        body: JSON.stringify({ name: `Other hardware ${unique}` }),
      }),
    );
    assert.equal(categoryTwoResponse.status, 201);
    const categoryTwo = (await categoryTwoResponse.json()).category;

    const brandResponse = await postBrand(
      authenticatedRequest("/api/catalog/brands", adminOneToken, {
        method: "POST",
        body: JSON.stringify({ name: `BuildPro ${unique}` }),
      }),
    );
    assert.equal(brandResponse.status, 201);
    const brand = (await brandResponse.json()).brand;

    const unauthenticatedResponse = await getProducts(
      new NextRequest("http://localhost:3000/api/products"),
    );
    assert.equal(unauthenticatedResponse.status, 401);

    const productResponse = await postProduct(
      authenticatedRequest("/api/products", adminOneToken, {
        method: "POST",
        body: JSON.stringify({
          businessId: "00000000-0000-4000-8000-000000000001",
          categoryId: categoryOne.id,
          brandId: brand.id,
          name: "Cement 50kg",
          sku: "cem-50",
          barcode: "123456789",
          description: "Portland cement",
          sizeDimensions: "50 kg",
          colour: "grey",
          baseUnitId: "00000000-0000-4000-8000-000000000002",
          purchasePrice: 10000,
          sellingPrice: 15000,
          minStockQuantity: 2500,
          vatClass: "standard",
        }),
      }),
    );
    assert.equal(productResponse.status, 201);
    const product = (await productResponse.json()).product;
    assert.equal(product.business_id, businessOneId);
    assert.equal(product.sku, "CEM-50");
    assert.equal(product.category_id, categoryOne.id);
    assert.equal(product.brand_id, brand.id);
    assert.equal(product.purchase_price, 10000);
    assert.equal(product.min_stock_quantity, 2500);

    const initialListResponse = await getProducts(
      authenticatedRequest("/api/products?search=cement&offset=0&limit=1", adminOneToken),
    );
    assert.equal(initialListResponse.status, 200);
    const initialList = await initialListResponse.json();
    assert.equal(initialList.total_count, 1);
    assert.equal(initialList.items[0].id, product.id);

    const otherBusinessList = await getProducts(
      authenticatedRequest("/api/products", adminTwoToken),
    );
    assert.deepEqual((await otherBusinessList.json()).items, []);

    const foreignCategoryResponse = await postProduct(
      authenticatedRequest("/api/products", adminOneToken, {
        method: "POST",
        body: JSON.stringify({
          name: "Foreign category product",
          sku: `foreign-${unique}`,
          baseUnitId: "00000000-0000-4000-8000-000000000002",
          categoryId: categoryTwo.id,
          purchasePrice: 1000,
          sellingPrice: 1500,
          minStockQuantity: 0,
          vatClass: "standard",
        }),
      }),
    );
    assert.equal(foreignCategoryResponse.status, 400);

    const belowCostProductResponse = await postProduct(
      authenticatedRequest("/api/products", adminOneToken, {
        method: "POST",
        body: JSON.stringify({
          name: "Below cost product",
          sku: `below-${unique}`,
          baseUnitId: "00000000-0000-4000-8000-000000000002",
          purchasePrice: 10000,
          sellingPrice: 9999,
          minStockQuantity: 0,
          vatClass: "standard",
        }),
      }),
    );
    assert.equal(belowCostProductResponse.status, 400);

    const duplicateSkuResponse = await postProduct(
      authenticatedRequest("/api/products", adminOneToken, {
        method: "POST",
        body: JSON.stringify({
          name: "Duplicate SKU",
          sku: "cem-50",
          baseUnitId: "00000000-0000-4000-8000-000000000002",
          purchasePrice: 10000,
          sellingPrice: 15000,
          minStockQuantity: 0,
          vatClass: "standard",
        }),
      }),
    );
    assert.equal(duplicateSkuResponse.status, 409);

    const baseUnitsResponse = await getProductUnits(
      authenticatedRequest(`/api/products/${product.id}/units`, adminOneToken),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(baseUnitsResponse.status, 200);
    const baseUnits = (await baseUnitsResponse.json()).units;
    assert.equal(baseUnits.length, 1);
    assert.equal(baseUnits[0].is_base, true);
    assert.equal(baseUnits[0].conversion_factor, 1000);

    const packageUnitResponse = await postProductUnit(
      authenticatedRequest(`/api/products/${product.id}/units`, adminOneToken, {
        method: "POST",
        body: JSON.stringify({
          unitId: "00000000-0000-4000-8000-000000000001",
          conversionFactor: 20000,
          sellingPrice: 270000,
        }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(packageUnitResponse.status, 201);
    const packageUnit = (await packageUnitResponse.json()).unit;
    assert.equal(packageUnit.conversion_factor, 20000);
    assert.equal(packageUnit.selling_price, 270000);

    const fractionalPackageResponse = await postProductUnit(
      authenticatedRequest(`/api/products/${product.id}/units`, adminOneToken, {
        method: "POST",
        body: JSON.stringify({
          unitId: "00000000-0000-4000-8000-000000000003",
          conversionFactor: 15500,
          sellingPrice: null,
        }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(fractionalPackageResponse.status, 400);

    const duplicateUnitResponse = await postProductUnit(
      authenticatedRequest(`/api/products/${product.id}/units`, adminOneToken, {
        method: "POST",
        body: JSON.stringify({
          unitId: "00000000-0000-4000-8000-000000000001",
          conversionFactor: 30000,
          sellingPrice: null,
        }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(duplicateUnitResponse.status, 409);

    const foreignProductUnitsResponse = await getProductUnits(
      authenticatedRequest(`/api/products/${product.id}/units`, adminTwoToken),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(foreignProductUnitsResponse.status, 404);

    const priceUpdateResponse = await patchProductSellingPrice(
      authenticatedRequest(`/api/products/${product.id}/selling-price`, adminOneToken, {
        method: "PATCH",
        body: JSON.stringify({ sellingPrice: 17500 }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(priceUpdateResponse.status, 200);
    assert.equal((await priceUpdateResponse.json()).product.selling_price, 17500);

    const belowCostPriceResponse = await patchProductSellingPrice(
      authenticatedRequest(`/api/products/${product.id}/selling-price`, adminOneToken, {
        method: "PATCH",
        body: JSON.stringify({ sellingPrice: 9999 }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(belowCostPriceResponse.status, 400);

    const historyResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE price_type = 'selling' AND unit_id = $2) AS selling_count,
         COUNT(*) FILTER (
           WHERE price_type = 'selling' AND unit_id = $2 AND effective_to IS NULL
         ) AS current_selling_count
       FROM product_prices
       WHERE product_id = $1`,
      [product.id, product.base_unit_id],
    );
    assert.equal(Number(historyResult.rows[0].selling_count), 2);
    assert.equal(Number(historyResult.rows[0].current_selling_count), 1);

    const managerReadResponse = await getProducts(
      authenticatedRequest("/api/products", managerToken),
    );
    assert.equal(managerReadResponse.status, 200);
    assert.equal((await managerReadResponse.json()).total_count, 1);
    await pool.query(
      `UPDATE business_manager_permissions
       SET enabled = FALSE
       WHERE business_id = $1 AND permission_id = 'catalog.manage'`,
      [businessOneId],
    );
    const managerCreateResponse = await postProduct(
      authenticatedRequest("/api/products", managerToken, {
        method: "POST",
        body: JSON.stringify({
          name: "Forbidden product",
          sku: `forbidden-${unique}`,
          baseUnitId: "00000000-0000-4000-8000-000000000002",
          purchasePrice: 1000,
          sellingPrice: 1500,
          minStockQuantity: 0,
          vatClass: "standard",
        }),
      }),
    );
    assert.equal(managerCreateResponse.status, 403);
    const managerUnitResponse = await postProductUnit(
      authenticatedRequest(`/api/products/${product.id}/units`, managerToken, {
        method: "POST",
        body: JSON.stringify({
          unitId: "00000000-0000-4000-8000-000000000003",
          conversionFactor: 2000,
          sellingPrice: null,
        }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(managerUnitResponse.status, 403);
    const managerPriceResponse = await patchProductSellingPrice(
      authenticatedRequest(`/api/products/${product.id}/selling-price`, managerToken, {
        method: "PATCH",
        body: JSON.stringify({ sellingPrice: 18000 }),
      }),
      { params: Promise.resolve({ productId: product.id }) },
    );
    assert.equal(managerPriceResponse.status, 403);

    assert.ok(managerId);
    const auditResult = await pool.query(
      `SELECT action
       FROM audit_logs
       WHERE business_id = $1
         AND action IN (
           'catalog.product_created',
           'catalog.product_selling_unit_created',
           'catalog.product_base_selling_price_updated'
         )`,
      [businessOneId],
    );
    assert.deepEqual(
      auditResult.rows.map((row) => row.action).sort(),
      [
        "catalog.product_base_selling_price_updated",
        "catalog.product_created",
        "catalog.product_selling_unit_created",
      ],
    );
  } finally {
    if (sessionHashes.length > 0) {
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = ANY($1::bytea[])", [sessionHashes]);
    }
    for (const businessId of businessIds) {
      await pool.query("DELETE FROM audit_logs WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM business_manager_permissions WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM branches WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
    await pool.end();
  }
});
