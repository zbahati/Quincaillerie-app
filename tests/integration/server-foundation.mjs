import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for the PostgreSQL integration test.");
}
process.env.DATABASE_URL = testDatabaseUrl;

const [
  { getDatabasePool },
  { withTransaction },
  { createBusiness, findBusinessById },
  { createBranch, findActiveBranchesWithoutManagers, findBranchForBusiness, listBranchesForBusiness },
  { findAuthCredentials, findUserForBusiness, createAdminUser, createManagerUser },
  { createAdminEmailVerificationToken, verifyAdminEmail, createAdminPasswordResetToken, completeAdminPasswordReset },
  {
    listManagerPermissions,
    replaceManagerPermissions,
    seedDefaultManagerPermissions,
  },
  { listPermissionsForUser },
  {
    createAuthSession,
    findActiveAuthSession,
    revokeAuthSession,
    revokeUserAuthSessions,
  },
  { recordAuditLog },
  { consumeAuthRateLimit },
  {
    branchDetailsSchema,
    managerCreateSchema,
    managerPermissionUpdateSchema,
  },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/repositories/branches.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/repositories/auth-tokens.ts"),
  import("../../src/lib/server/repositories/manager-permissions.ts"),
  import("../../src/lib/server/repositories/permissions.ts"),
  import("../../src/lib/server/repositories/auth-sessions.ts"),
  import("../../src/lib/server/repositories/audit-logs.ts"),
  import("../../src/lib/server/repositories/auth-rate-limits.ts"),
  import("../../src/lib/server/schemas/identity.ts"),
]);

test("identity repositories use scoped queries and roll back all writes", async () => {
  const pool = getDatabasePool();
  let createdBusinessId;
  const rateLimitHash = createHash("sha256")
    .update(`foundation-test:${Date.now()}`)
    .digest();
  const rollbackSignal = new Error("expected integration-test rollback");

  try {
    assert.equal((await consumeAuthRateLimit(pool, rateLimitHash, 1, 60)).allowed, true);
    assert.equal((await consumeAuthRateLimit(pool, rateLimitHash, 1, 60)).allowed, false);
    await assert.rejects(
      withTransaction(async (client) => {
        const business = await createBusiness(client, { name: "Repository Test Business" });
        createdBusinessId = business.id;

        await seedDefaultManagerPermissions(client, business.id);
        const branch = await createBranch(
          client,
          business.id,
          branchDetailsSchema.parse({
            name: "Main Branch",
            address: "Test address",
            phone: null,
          }),
        );
        assert.equal(
          (await findActiveBranchesWithoutManagers(client, business.id)).length,
          1,
        );
        const listedBranches = await listBranchesForBusiness(client, business.id);
        assert.equal(listedBranches.length, 1);
        assert.equal(listedBranches[0].id, branch.id);
        assert.equal(
          await findBranchForBusiness(client, "00000000-0000-4000-8000-000000000001", branch.id),
          null,
        );

        const admin = await createAdminUser(client, {
          businessId: business.id,
          username: "admin",
          fullName: "Test Admin",
          email: "admin@example.com",
          passwordHash: "$argon2id$integration-test",
        });
        const managerInput = managerCreateSchema.parse({
          branchId: branch.id,
          username: "manager.one",
          fullName: "Test Manager",
          password: "A-long-enough-password",
        });
        const manager = await createManagerUser(client, {
          businessId: business.id,
          branchId: managerInput.branchId,
          username: managerInput.username,
          fullName: managerInput.fullName,
          passwordHash: "$argon2id$integration-test",
        });

        const credentials = await findAuthCredentials(client, business.id, manager.username);
        assert.equal(credentials?.id, manager.id);
        assert.equal(credentials?.passwordHash, "$argon2id$integration-test");
        assert.equal((await findUserForBusiness(client, business.id, manager.id))?.id, manager.id);

        const initialGrants = await listManagerPermissions(client, business.id);
        assert.equal(initialGrants.length, 20);
        const updatedGrants = managerPermissionUpdateSchema.parse(
          initialGrants.map((grant, index) => ({
            permissionId: grant.permissionId,
            enabled: index !== 0,
          })),
        );
        await replaceManagerPermissions(client, business.id, admin.id, updatedGrants);
        const storedGrants = await listManagerPermissions(client, business.id);
        assert.equal(storedGrants.length, 20);
        assert.equal(storedGrants[0].enabled, false);
        assert.equal(
          (await listPermissionsForUser(client, business.id, manager.role)).length,
          19,
        );
        assert.equal((await listPermissionsForUser(client, business.id, admin.role)).length, 25);

        await assert.rejects(
          createAdminPasswordResetToken(client, {
            businessId: business.id,
            userId: admin.id,
            tokenHash: Buffer.alloc(32, 4),
            expiresAt: new Date(Date.now() + 60_000),
          }),
          /only be issued to an active, verified Admin/,
        );

        const managerTokenHash = Buffer.alloc(32, 1);
        await createAuthSession(client, {
          businessId: business.id,
          userId: manager.id,
          tokenHash: managerTokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        });
        assert.equal((await findActiveAuthSession(client, managerTokenHash))?.userId, manager.id);
        assert.equal(await revokeAuthSession(client, managerTokenHash), true);
        assert.equal(await findActiveAuthSession(client, managerTokenHash), null);

        await createAuthSession(client, {
          businessId: business.id,
          userId: manager.id,
          tokenHash: Buffer.alloc(32, 2),
          expiresAt: new Date(Date.now() + 60_000),
        });
        assert.equal(await revokeUserAuthSessions(client, business.id, manager.id), 1);

        const verificationTokenHash = Buffer.alloc(32, 5);
        await createAdminEmailVerificationToken(client, {
          businessId: business.id,
          userId: admin.id,
          tokenHash: verificationTokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        });
        assert.deepEqual(await verifyAdminEmail(client, verificationTokenHash), {
          userId: admin.id,
          businessId: business.id,
        });
        assert.equal(await verifyAdminEmail(client, verificationTokenHash), null);

        const adminTokenHash = Buffer.alloc(32, 3);
        await createAuthSession(client, {
          businessId: business.id,
          userId: admin.id,
          tokenHash: adminTokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        });
        assert.equal((await findActiveAuthSession(client, adminTokenHash))?.userId, admin.id);
        await recordAuditLog(client, {
          businessId: business.id,
          userId: admin.id,
          action: "admin.email_verified",
          entityType: "user",
          entityId: admin.id,
          details: { method: "integration-test" },
        });

        const resetTokenHash = Buffer.alloc(32, 6);
        await createAdminPasswordResetToken(client, {
          businessId: business.id,
          userId: admin.id,
          tokenHash: resetTokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        });
        assert.deepEqual(await completeAdminPasswordReset(
          client,
          resetTokenHash,
          "$argon2id$integration-reset",
        ), {
          userId: admin.id,
          businessId: business.id,
        });
        assert.equal(await revokeUserAuthSessions(client, business.id, admin.id), 1);
        assert.equal(await findActiveAuthSession(client, adminTokenHash), null);
        assert.equal(
          (await findAuthCredentials(client, business.id, admin.username))?.passwordHash,
          "$argon2id$integration-reset",
        );

        throw rollbackSignal;
      }),
      (error) => error === rollbackSignal,
    );

    assert.ok(createdBusinessId);
    assert.equal(await findBusinessById(pool, createdBusinessId), null);
  } finally {
    await pool.query("DELETE FROM auth_rate_limits WHERE key_hash = $1", [rateLimitHash]);
    await pool.end();
  }
});
