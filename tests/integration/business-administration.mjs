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
  { seedDefaultManagerPermissions },
  { createAdminUser },
  { createAuthSession },
  { createOpaqueToken, hashOpaqueToken },
  { signIn },
  { managerCreateSchema, branchDetailsSchema, managerPasswordResetSchema },
  {
    createBusinessBranch,
    createBusinessManager,
    getBusinessAdministration,
    getBusinessManagerPermissions,
    listBusinessBranches,
    listBusinessManagers,
    resetBusinessManagerPassword,
    updateBusinessBranch,
    updateBusinessManager,
    updateBusinessManagerPermissions,
    updateBusinessAdministration,
  },
  { findActiveAuthSession },
  { authSessionCookieName },
  { GET: listBranchesRoute, POST: createBranchRoute },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/repositories/manager-permissions.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/lib/server/services/auth.ts"),
  import("../../src/lib/server/schemas/identity.ts"),
  import("../../src/lib/server/services/business-administration.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/app/api/admin/branches/route.ts"),
]);

test("Admin branch and Manager administration enforces coverage transactionally", async () => {
  const pool = getDatabasePool();
  const rateLimitKeys = [];
  let businessId;
  const now = Date.now();
  const unique = String(now);

  try {
    let admin;
    await withTransaction(async (client) => {
      const business = await createBusiness(client, {
        name: `Administration test ${unique}`,
      });
      businessId = business.id;
      admin = await createAdminUser(client, {
        businessId,
        username: `admin.${unique.slice(-8)}`,
        fullName: "Integration Admin",
        email: `admin-${unique}@example.test`,
        passwordHash: "$argon2id$integration-test",
      });
      await client.query(
        "UPDATE users SET email_verified_at = now() WHERE business_id = $1 AND id = $2",
        [businessId, admin.id],
      );
      await seedDefaultManagerPermissions(client, businessId);
    });

    const adminContext = {
      businessId,
      userId: admin.id,
      role: "admin",
      branchId: null,
      permissions: [],
    };
    const managerContext = {
      ...adminContext,
      role: "manager",
      branchId: "00000000-0000-4000-8000-000000000001",
    };
    const firstManagerUsername = `manager.${unique.slice(-8)}.one`;
    const branchLimitIdentity = `${businessId}:${admin.id}`;
    const managerLimitIdentity = `${businessId}:${admin.id}`;
    for (const [scope, identity] of [
      ["branch-create", branchLimitIdentity],
      ["manager-create-global", "all"],
      ["manager-create", managerLimitIdentity],
      ["manager-password-reset-global", "all"],
      ["sign-in-global", "all"],
      ["sign-in", `${businessId}:${firstManagerUsername}`],
    ]) {
      rateLimitKeys.push(hashOpaqueToken(`${scope}:${identity}`));
    }

    const business = await getBusinessAdministration(adminContext);
    assert.equal(business.id, businessId);
    await updateBusinessAdministration(adminContext, {
      name: `${business.name} Updated`,
      taxId: "TAX-123",
    });
    assert.equal((await getBusinessAdministration(adminContext)).tax_id, "TAX-123");

    const branchOne = await createBusinessBranch(
      adminContext,
      branchDetailsSchema.parse({ name: "Main branch", address: "Central", phone: null }),
    );
    assert.equal(branchOne.is_active, false);
    await assert.rejects(
      updateBusinessBranch(adminContext, branchOne.id, { isActive: true }),
      (error) => error?.code === "branch_manager_required",
    );
    assert.equal((await listBusinessBranches(adminContext))[0]?.is_active, false);

    const firstPassword = `Long-password-${unique}-one`;
    const firstManagerInput = managerCreateSchema.parse({
      branchId: branchOne.id,
      username: firstManagerUsername,
      fullName: "First Manager",
      password: firstPassword,
    });
    const firstManager = await createBusinessManager(adminContext, firstManagerInput);
    assert.equal(firstManager.branch_id, branchOne.id);
    const renamedManager = await updateBusinessManager(
      adminContext,
      firstManager.id,
      { fullName: "First Manager Renamed" },
    );
    assert.equal(renamedManager.full_name, "First Manager Renamed");
    rateLimitKeys.push(
      hashOpaqueToken(`manager-password-reset:${businessId}:${firstManager.id}`),
    );
    await assert.rejects(
      createBusinessManager(adminContext, firstManagerInput),
      (error) => error?.code === "username_taken",
    );
    const activeBranchOne = await updateBusinessBranch(
      adminContext,
      branchOne.id,
      { isActive: true },
    );
    assert.equal(activeBranchOne.is_active, true);
    assert.equal(activeBranchOne.active_manager_count, 1);
    await assert.rejects(
      updateBusinessManager(adminContext, firstManager.id, { isActive: false }),
      (error) => error?.code === "branch_manager_required",
    );

    const secondManager = await createBusinessManager(
      adminContext,
      managerCreateSchema.parse({
        branchId: branchOne.id,
        username: `manager.${unique.slice(-8)}.two`,
        fullName: "Second Manager",
        password: `Long-password-${unique}-two`,
      }),
    );
    await updateBusinessManager(adminContext, secondManager.id, { isActive: false });
    assert.equal(
      (await listBusinessManagers(adminContext)).find((item) => item.id === secondManager.id)?.is_active,
      false,
    );
    await updateBusinessManager(adminContext, secondManager.id, { isActive: true });

    const branchTwo = await createBusinessBranch(
      adminContext,
      branchDetailsSchema.parse({ name: "Second branch" }),
    );
    const thirdManager = await createBusinessManager(
      adminContext,
      managerCreateSchema.parse({
        branchId: branchTwo.id,
        username: `manager.${unique.slice(-8)}.three`,
        fullName: "Third Manager",
        password: `Long-password-${unique}-three`,
      }),
    );
    await updateBusinessBranch(adminContext, branchTwo.id, { isActive: true });

    const firstSessionToken = createOpaqueToken();
    await withTransaction(async (client) => {
      await createAuthSession(client, {
        businessId,
        userId: firstManager.id,
        tokenHash: hashOpaqueToken(firstSessionToken),
        expiresAt: new Date(Date.now() + 60_000),
      });
    });
    await assert.rejects(
      listBusinessBranches(managerContext),
      (error) => error?.status === 403,
    );

    const adminToken = createOpaqueToken();
    const managerToken = createOpaqueToken();
    await withTransaction(async (client) => {
      await createAuthSession(client, {
        businessId,
        userId: admin.id,
        tokenHash: hashOpaqueToken(adminToken),
        expiresAt: new Date(Date.now() + 60_000),
      });
      await createAuthSession(client, {
        businessId,
        userId: thirdManager.id,
        tokenHash: hashOpaqueToken(managerToken),
        expiresAt: new Date(Date.now() + 60_000),
      });
    });

    const anonymousResponse = await listBranchesRoute(
      new NextRequest("http://localhost:3000/api/admin/branches"),
    );
    assert.equal(anonymousResponse.status, 401);
    const managerResponse = await listBranchesRoute(
      new NextRequest("http://localhost:3000/api/admin/branches", {
        headers: { Cookie: `${authSessionCookieName()}=${managerToken}` },
      }),
    );
    assert.equal(managerResponse.status, 403);
    const adminResponse = await listBranchesRoute(
      new NextRequest("http://localhost:3000/api/admin/branches", {
        headers: { Cookie: `${authSessionCookieName()}=${adminToken}` },
      }),
    );
    assert.equal(adminResponse.status, 200);

    const invalidOriginResponse = await createBranchRoute(
      new NextRequest("http://localhost:3000/api/admin/branches", {
        method: "POST",
        headers: {
          Cookie: `${authSessionCookieName()}=${adminToken}`,
          Origin: "https://untrusted.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Must not be created" }),
      }),
    );
    assert.equal(invalidOriginResponse.status, 403);

    await updateBusinessManager(adminContext, firstManager.id, { branchId: branchTwo.id });
    assert.equal(
      await findActiveAuthSession(pool, hashOpaqueToken(firstSessionToken)),
      null,
    );
    const secondSessionToken = createOpaqueToken();
    await withTransaction(async (client) => {
      await createAuthSession(client, {
        businessId,
        userId: secondManager.id,
        tokenHash: hashOpaqueToken(secondSessionToken),
        expiresAt: new Date(Date.now() + 60_000),
      });
    });
    await updateBusinessBranch(adminContext, branchOne.id, { isActive: false });
    const revokedBranchSession = await pool.query(
      "SELECT revoked_at FROM auth_sessions WHERE token_hash = $1",
      [hashOpaqueToken(secondSessionToken)],
    );
    assert.ok(revokedBranchSession.rows[0]?.revoked_at);
    await updateBusinessManager(adminContext, secondManager.id, { isActive: false });

    const newManagerPassword = `Reset-password-${unique}`;
    await resetBusinessManagerPassword(
      adminContext,
      firstManager.id,
      managerPasswordResetSchema.parse({ password: newManagerPassword }),
    );
    await assert.rejects(
      signIn({
        businessId,
        username: firstManagerUsername,
        password: firstPassword,
      }),
      (error) => error?.status === 401,
    );
    const newPasswordSignIn = await signIn({
      businessId,
      username: firstManagerUsername,
      password: newManagerPassword,
    });
    assert.equal(newPasswordSignIn.session.user.id, firstManager.id);

    const concurrentDeactivations = await Promise.allSettled([
      updateBusinessManager(adminContext, firstManager.id, { isActive: false }),
      updateBusinessManager(adminContext, thirdManager.id, { isActive: false }),
    ]);
    assert.equal(
      concurrentDeactivations.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejectedDeactivation = concurrentDeactivations.find(
      (result) => result.status === "rejected",
    );
    assert.equal(rejectedDeactivation?.status, "rejected");
    assert.equal(rejectedDeactivation.reason?.code, "branch_manager_required");

    const initialPermissions = await getBusinessManagerPermissions(adminContext);
    const updatedPermissions = await updateBusinessManagerPermissions(
      adminContext,
      initialPermissions.map((permission, index) => ({
        permissionId: permission.permissionId,
        enabled: index !== 0,
      })),
    );
    assert.equal(updatedPermissions.length, initialPermissions.length);
    assert.equal(
      updatedPermissions.find((permission) => permission.permissionId === initialPermissions[0]?.permissionId)?.enabled,
      false,
    );
    assert.equal((await listBusinessBranches(adminContext)).find((item) => item.id === branchTwo.id)?.active_manager_count, 1);
  } finally {
    if (businessId) {
      await pool.query("DELETE FROM audit_logs WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM business_manager_permissions WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM branches WHERE business_id = $1", [businessId]);
      await pool.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
    if (rateLimitKeys.length > 0) {
      await pool.query("DELETE FROM auth_rate_limits WHERE key_hash = ANY($1::bytea[])", [rateLimitKeys]);
    }
    await pool.end();
  }
});
