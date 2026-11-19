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
  { createAdminUser, createManagerUser },
  { seedDefaultManagerPermissions },
  { createBranch },
  { createAuthSession },
  { createOpaqueToken, hashOpaqueToken, authSessionCookieName },
  { GET: getBusinessSettings, PATCH: patchBusinessSettings },
  { GET: getCategories, POST: postCategory },
  { GET: getBrands, POST: postBrand },
  { GET: getUnits, POST: postUnit },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/repositories/manager-permissions.ts"),
  import("../../src/lib/server/repositories/branches.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/app/api/settings/business/route.ts"),
  import("../../src/app/api/catalog/categories/route.ts"),
  import("../../src/app/api/catalog/brands/route.ts"),
  import("../../src/app/api/catalog/units/route.ts"),
]);

test("business settings and catalog APIs preserve access and tenant scope", async () => {
  const pool = getDatabasePool();
  const businessIds = [];
  const sessionHashes = [];
  const unique = String(Date.now());
  const cookieName = authSessionCookieName();
  const originHeaders = {
    Origin: "http://localhost:3000",
    "Content-Type": "application/json",
  };
  let adminOne;
  let managerOne;
  let adminTwo;
  let businessOneId;
  let adminOneToken;
  let managerOneToken;
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
      const businessOne = await createBusiness(client, { name: `Catalog test ${unique}` });
      businessOneId = businessOne.id;
      businessIds.push(businessOne.id);
      adminOne = await createAdminUser(client, {
        businessId: businessOne.id,
        username: `admin.${unique.slice(-8)}`,
        fullName: "Catalog Admin",
        email: `catalog-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query(
        "UPDATE users SET email_verified_at = now() WHERE business_id = $1 AND id = $2",
        [businessOne.id, adminOne.id],
      );
      const branch = await createBranch(client, businessOne.id, { name: "Catalog branch" }, true);
      managerOne = await createManagerUser(client, {
        businessId: businessOne.id,
        branchId: branch.id,
        username: `manager.${unique.slice(-8)}`,
        fullName: "Catalog Manager",
        passwordHash: "$argon2id$integration-test",
      });
      await seedDefaultManagerPermissions(client, businessOne.id);

      const businessTwo = await createBusiness(client, { name: `Other catalog ${unique}` });
      businessIds.push(businessTwo.id);
      adminTwo = await createAdminUser(client, {
        businessId: businessTwo.id,
        username: `admin.other.${unique.slice(-8)}`,
        fullName: "Other Catalog Admin",
        email: `catalog-other-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query(
        "UPDATE users SET email_verified_at = now() WHERE business_id = $1 AND id = $2",
        [businessTwo.id, adminTwo.id],
      );

      adminOneToken = createOpaqueToken();
      managerOneToken = createOpaqueToken();
      adminTwoToken = createOpaqueToken();
      for (const [userId, token] of [
        [adminOne.id, adminOneToken],
        [managerOne.id, managerOneToken],
        [adminTwo.id, adminTwoToken],
      ]) {
        const tokenHash = hashOpaqueToken(token);
        sessionHashes.push(tokenHash);
        await createAuthSession(client, {
          businessId: userId === adminTwo.id ? businessTwo.id : businessOne.id,
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        });
      }
    });

    const initialUnitsResponse = await getUnits(
      authenticatedRequest("/api/catalog/units", adminOneToken),
    );
    assert.equal(initialUnitsResponse.status, 200);
    const initialUnits = await initialUnitsResponse.json();
    assert.equal(initialUnits.units.length, 14);
    assert.ok(initialUnits.units.every((unit) => unit.is_system && unit.business_id === null));

    const createdUnitResponse = await postUnit(
      authenticatedRequest("/api/catalog/units", adminOneToken, {
        method: "POST",
        body: JSON.stringify({ code: "BOX", name: "Box", decimalsOk: false }),
      }),
    );
    assert.equal(createdUnitResponse.status, 201);
    const createdUnit = (await createdUnitResponse.json()).unit;
    assert.equal(createdUnit.code, "box");
    assert.equal(createdUnit.business_id, businessOneId);
    assert.equal(createdUnit.is_system, false);

    const duplicateUnitResponse = await postUnit(
      authenticatedRequest("/api/catalog/units", adminOneToken, {
        method: "POST",
        body: JSON.stringify({ code: "box", name: "Another box", decimalsOk: false }),
      }),
    );
    assert.equal(duplicateUnitResponse.status, 409);

    const brandResponse = await postBrand(
      authenticatedRequest("/api/catalog/brands", adminOneToken, {
        method: "POST",
        body: JSON.stringify({ name: "BuildPro" }),
      }),
    );
    assert.equal(brandResponse.status, 201);
    assert.equal((await brandResponse.json()).brand.business_id, businessOneId);
    const otherBusinessBrandsResponse = await getBrands(
      authenticatedRequest("/api/catalog/brands", adminTwoToken),
    );
    assert.deepEqual((await otherBusinessBrandsResponse.json()).brands, []);
    const duplicateBrandResponse = await postBrand(
      authenticatedRequest("/api/catalog/brands", adminOneToken, {
        method: "POST",
        body: JSON.stringify({ name: "BuildPro" }),
      }),
    );
    assert.equal(duplicateBrandResponse.status, 409);

    const parentResponse = await postCategory(
      authenticatedRequest("/api/catalog/categories", adminOneToken, {
        method: "POST",
        body: JSON.stringify({
          name: "Building materials",
          description: "Core stock",
        }),
      }),
    );
    assert.equal(parentResponse.status, 201);
    const parent = (await parentResponse.json()).category;
    const childResponse = await postCategory(
      authenticatedRequest("/api/catalog/categories", adminOneToken, {
        method: "POST",
        body: JSON.stringify({ parentId: parent.id, name: "Cement" }),
      }),
    );
    assert.equal(childResponse.status, 201);
    assert.equal((await childResponse.json()).category.parent_id, parent.id);

    const otherBusinessCategoryResponse = await postCategory(
      authenticatedRequest("/api/catalog/categories", adminTwoToken, {
        method: "POST",
        body: JSON.stringify({ name: "Other business category" }),
      }),
    );
    assert.equal(otherBusinessCategoryResponse.status, 201);
    const otherBusinessCategory = (await otherBusinessCategoryResponse.json()).category;
    const crossBusinessParentResponse = await postCategory(
      authenticatedRequest("/api/catalog/categories", adminOneToken, {
        method: "POST",
        body: JSON.stringify({
          parentId: otherBusinessCategory.id,
          name: "Invalid child",
        }),
      }),
    );
    assert.equal(crossBusinessParentResponse.status, 400);

    const otherBusinessCategoriesResponse = await getCategories(
      authenticatedRequest("/api/catalog/categories", adminTwoToken),
    );
    const otherBusinessCategories = await otherBusinessCategoriesResponse.json();
    assert.deepEqual(
      otherBusinessCategories.categories.map((category) => category.name),
      ["Other business category"],
    );

    const managerSettingsResponse = await getBusinessSettings(
      authenticatedRequest("/api/settings/business", managerOneToken),
    );
    assert.equal(managerSettingsResponse.status, 200);
    assert.equal((await managerSettingsResponse.json()).business.id, businessOneId);
    const managerUpdateResponse = await patchBusinessSettings(
      authenticatedRequest("/api/settings/business", managerOneToken, {
        method: "PATCH",
        body: JSON.stringify({ name: "Manager must not update", taxId: null }),
      }),
    );
    assert.equal(managerUpdateResponse.status, 403);

    const adminUpdateResponse = await patchBusinessSettings(
      authenticatedRequest("/api/settings/business", adminOneToken, {
        method: "PATCH",
        body: JSON.stringify({ name: `Updated ${unique}`, taxId: "TIN-123" }),
      }),
    );
    assert.equal(adminUpdateResponse.status, 200);
    const updatedSettings = (await adminUpdateResponse.json()).business;
    assert.equal(updatedSettings.name, `Updated ${unique}`);
    assert.equal(updatedSettings.tax_id, "TIN-123");

    await pool.query(
      `UPDATE business_manager_permissions
       SET enabled = FALSE
       WHERE business_id = $1 AND permission_id = 'catalog.manage'`,
      [businessOneId],
    );
    const managerReadResponse = await getCategories(
      authenticatedRequest("/api/catalog/categories", managerOneToken),
    );
    assert.equal(managerReadResponse.status, 200);
    const managerCreateResponse = await postBrand(
      authenticatedRequest("/api/catalog/brands", managerOneToken, {
        method: "POST",
        body: JSON.stringify({ name: "Forbidden brand" }),
      }),
    );
    assert.equal(managerCreateResponse.status, 403);
  } finally {
    for (const businessId of businessIds) {
      await pool.query("DELETE FROM audit_logs WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM business_manager_permissions WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM branches WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
    if (sessionHashes.length > 0) {
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = ANY($1::bytea[])", [sessionHashes]);
    }
    await pool.end();
  }
});
