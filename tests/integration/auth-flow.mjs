import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for the PostgreSQL integration test.");
}
process.env.DATABASE_URL = testDatabaseUrl;
process.env.WEB_BASE_URL = "http://localhost:3000";
process.env.RESEND_API_KEY = "test-resend-key";
process.env.RESEND_FROM_EMAIL = "Quincaillerie Test <noreply@example.test>";

const [
  { getDatabasePool },
  { withTransaction },
  { createBusiness },
  { adminBootstrapSchema, branchDetailsSchema },
  {
    assertActiveBranchManagerCoverage,
    bootstrapAdmin,
    completeAdminPasswordReset,
    currentSession,
    listBusinesses,
    requestAdminPasswordReset,
    signIn,
    verifyAdminEmail,
  },
  { createBranch },
  { createManagerUser },
  { hashOpaqueToken, hashPassword },
  { findAuthenticatedContext, requireBusinessScope, requirePermission },
  { AuthServiceError },
  { POST: loginRoute },
  { POST: logoutRoute },
  { POST: verificationRequestRoute },
] = await Promise.all([
  import("../../src/lib/server/db/pool.ts"),
  import("../../src/lib/server/db/transaction.ts"),
  import("../../src/lib/server/repositories/businesses.ts"),
  import("../../src/lib/server/schemas/identity.ts"),
  import("../../src/lib/server/services/auth.ts"),
  import("../../src/lib/server/repositories/branches.ts"),
  import("../../src/lib/server/repositories/users.ts"),
  import("../../src/lib/server/auth/crypto.ts"),
  import("../../src/lib/server/auth/authorization.ts"),
  import("../../src/lib/server/auth/errors.ts"),
  import("../../src/app/api/auth/login/route.ts"),
  import("../../src/app/api/auth/logout/route.ts"),
  import("../../src/app/api/auth/verification/request/route.ts"),
]);

test("Admin email verification, sign-in, Manager scope and password reset work end to end", async () => {
  const pool = getDatabasePool();
  const originalFetch = globalThis.fetch;
  const outgoingEmails = [];
  const rateLimitKeys = [];
  let businessId;
  let setupBusinessId;
  const originalBootstrapSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
  const trackRateLimitKey = (scope, identity) => {
    rateLimitKeys.push(hashOpaqueToken(`${scope}:${identity}`));
  };

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    outgoingEmails.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "email_test_id" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const invalidOriginResponse = await loginRoute(
      new NextRequest(`${process.env.WEB_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          Origin: "https://untrusted.example",
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );
    assert.equal(invalidOriginResponse.status, 403);
    assert.match(invalidOriginResponse.headers.get("cache-control") ?? "", /no-store/);

    const now = Date.now();
    const email = `admin-${now}@example.test`;
    const username = `admin.${String(now).slice(-8)}`;
    const initialPassword = "Initial-password-2026";
    const business = await withTransaction((client) =>
      createBusiness(client, { name: `Auth flow test ${now}` }),
    );
    businessId = business.id;
    trackRateLimitKey("admin-bootstrap-global", "all");
    trackRateLimitKey("admin-bootstrap", `${businessId}:${email}`);
    const bootstrap = await bootstrapAdmin(
      adminBootstrapSchema.parse({
        businessId,
        businessName: null,
        username,
        fullName: "Integration Admin",
        email,
        password: initialPassword,
      }),
    );
    assert.equal(bootstrap.status, "verification_pending");
    assert.equal(bootstrap.email_delivery, "sent");
    businessId = bootstrap.business_id;

    const pendingBusiness = (await listBusinesses()).find((business) => business.id === businessId);
    assert.equal(pendingBusiness?.requires_admin_verification, true);
    await assert.rejects(
      signIn({ businessId, username, password: initialPassword }),
      (error) => error instanceof AuthServiceError && error.status === 401,
    );

    const verificationMessage = outgoingEmails.at(-1);
    const verificationToken = verificationMessage?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(verificationToken);
    trackRateLimitKey("admin-email-verify-global", "all");
    trackRateLimitKey("admin-email-verify", verificationToken);
    await verifyAdminEmail(verificationToken);
    await assert.rejects(
      verifyAdminEmail(verificationToken),
      (error) => error instanceof AuthServiceError && error.code === "invalid_verification_token",
    );

    const verifiedBusiness = (await listBusinesses()).find((business) => business.id === businessId);
    assert.equal(verifiedBusiness?.requires_admin_verification, false);

    trackRateLimitKey("sign-in-global", "all");
    trackRateLimitKey("sign-in", `${businessId}:${username}`);
    const adminLoginResponse = await loginRoute(
      new NextRequest(`${process.env.WEB_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          Origin: process.env.WEB_BASE_URL,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ businessId, username, password: initialPassword }),
      }),
    );
    assert.equal(adminLoginResponse.status, 200);
    const adminLoginBody = await adminLoginResponse.json();
    assert.equal(adminLoginBody.session.user.role, "admin");
    assert.ok(adminLoginBody.session.permissions.includes("roles.manage"));
    const sessionCookie = adminLoginResponse.headers.get("set-cookie") ?? "";
    assert.match(sessionCookie, /HttpOnly/i);
    assert.match(sessionCookie, /SameSite=lax/i);
    const adminSessionToken = sessionCookie.match(/qk_session=([^;]+)/)?.[1];
    assert.ok(adminSessionToken);
    assert.deepEqual(
      (await currentSession(adminSessionToken))?.user,
      adminLoginBody.session.user,
    );
    const adminContext = await findAuthenticatedContext(adminSessionToken);
    assert.ok(adminContext);
    requirePermission(adminContext, "roles.manage");
    assert.throws(
      () => requireBusinessScope(adminContext, "00000000-0000-4000-8000-000000000001"),
      (error) => error instanceof AuthServiceError && error.status === 403,
    );

    const branch = await withTransaction((client) =>
      createBranch(
        client,
        businessId,
        branchDetailsSchema.parse({ name: "Coverage Test Branch" }),
      ),
    );
    await assert.rejects(
      assertActiveBranchManagerCoverage(pool, businessId),
      (error) => error instanceof AuthServiceError && error.code === "branch_manager_required",
    );

    const managerPassword = "Manager-password-2026";
    const managerPasswordHash = await hashPassword(managerPassword);
    const managerUsername = `manager.${String(now).slice(-8)}`;
    await withTransaction(async (client) => {
      await createManagerUser(client, {
        businessId,
        branchId: branch.id,
        username: managerUsername,
        fullName: "Integration Manager",
        passwordHash: managerPasswordHash,
      });
    });
    await assert.doesNotReject(assertActiveBranchManagerCoverage(pool, businessId));

    trackRateLimitKey("sign-in", `${businessId}:${managerUsername}`);
    const managerSignIn = await signIn({
      businessId,
      username: managerUsername,
      password: managerPassword,
    });
    const managerContext = await findAuthenticatedContext(managerSignIn.sessionToken);
    assert.ok(managerContext);
    requireBusinessScope(managerContext, businessId, branch.id);
    requirePermission(managerContext, "inventory.read");
    assert.throws(
      () => requireBusinessScope(managerContext, businessId, "00000000-0000-4000-8000-000000000001"),
      (error) => error instanceof AuthServiceError && error.status === 403,
    );
    assert.throws(
      () => requirePermission(managerContext, "reports.read"),
      (error) => error instanceof AuthServiceError && error.status === 403,
    );

    trackRateLimitKey("admin-password-reset-global", "all");
    trackRateLimitKey("admin-password-reset", `${businessId}:${email}`);
    await requestAdminPasswordReset({ businessId, email });
    const resetMessage = outgoingEmails.at(-1);
    const resetToken = resetMessage?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(resetToken);
    const replacementPassword = "Replacement-password-2026";
    trackRateLimitKey("admin-password-reset-complete-global", "all");
    trackRateLimitKey("admin-password-reset-complete", resetToken);
    await completeAdminPasswordReset({ token: resetToken, newPassword: replacementPassword });
    assert.equal(await currentSession(adminSessionToken), null);
    await assert.rejects(
      signIn({ businessId, username, password: initialPassword }),
      (error) => error instanceof AuthServiceError && error.status === 401,
    );
    const replacementSignIn = await signIn({
      businessId,
      username,
      password: replacementPassword,
    });
    const logoutResponse = await logoutRoute(
      new NextRequest(`${process.env.WEB_BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: {
          Origin: process.env.WEB_BASE_URL,
          Cookie: `qk_session=${replacementSignIn.sessionToken}`,
        },
        body: "{}",
      }),
    );
    assert.equal(logoutResponse.status, 204);
    assert.match(logoutResponse.headers.get("set-cookie") ?? "", /Max-Age=0/i);
    assert.equal(await currentSession(replacementSignIn.sessionToken), null);
    await assert.rejects(
      completeAdminPasswordReset({ token: resetToken, newPassword: initialPassword }),
      (error) => error instanceof AuthServiceError && error.code === "invalid_reset_token",
    );

    const setupNow = Date.now();
    const setupEmail = `setup-admin-${setupNow}@example.test`;
    const setupUsername = `setup.${String(setupNow).slice(-8)}`;
    const setupPassword = "Setup-admin-password-2026";
    const setupBusiness = await withTransaction((client) =>
      createBusiness(client, { name: `Setup secret test ${setupNow}` }),
    );
    setupBusinessId = setupBusiness.id;
    trackRateLimitKey("admin-bootstrap-global", "all");
    trackRateLimitKey("admin-bootstrap", `${setupBusinessId}:${setupEmail}`);
    const setupBootstrap = await bootstrapAdmin(
      adminBootstrapSchema.parse({
        businessId: setupBusinessId,
        businessName: null,
        username: setupUsername,
        fullName: "Setup Secret Admin",
        email: setupEmail,
        password: setupPassword,
      }),
    );
    assert.equal(setupBootstrap.status, "verification_pending");
    const setupVerificationMessage = outgoingEmails.at(-1);
    const setupVerificationToken =
      setupVerificationMessage?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(setupVerificationToken);
    const setupSecret = `temporary-admin-setup-secret-${setupNow}-for-tests`;
    const verificationRequest = (secret) =>
      verificationRequestRoute(
        new NextRequest(`${process.env.WEB_BASE_URL}/api/auth/verification/request`, {
          method: "POST",
          headers: {
            Origin: process.env.WEB_BASE_URL,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            businessId: setupBusinessId,
            email: setupEmail,
            setupSecret: secret,
          }),
        }),
      );
    trackRateLimitKey("admin-setup-secret-global", "all");
    trackRateLimitKey("admin-setup-secret", `${setupBusinessId}:${setupEmail}`);
    delete process.env.ADMIN_BOOTSTRAP_SECRET;
    assert.equal((await verificationRequest("x".repeat(32))).status, 503);
    process.env.ADMIN_BOOTSTRAP_SECRET = setupSecret;
    assert.equal((await verificationRequest("x".repeat(32))).status, 403);
    const setupVerificationResponse = await verificationRequest(setupSecret);
    assert.equal(setupVerificationResponse.status, 200);
    assert.deepEqual(await setupVerificationResponse.json(), { status: "verified" });
    const setupVerifiedBusiness = (await listBusinesses()).find(
      (business) => business.id === setupBusinessId,
    );
    assert.equal(setupVerifiedBusiness?.requires_admin_verification, false);
    const setupAuditEvent = await pool.query(
      `SELECT 1
       FROM audit_logs
       WHERE business_id = $1
         AND action = 'auth.admin_email_verified_with_setup_secret'`,
      [setupBusinessId],
    );
    assert.equal(setupAuditEvent.rowCount, 1);
    trackRateLimitKey("sign-in-global", "all");
    trackRateLimitKey("sign-in", `${setupBusinessId}:${setupUsername}`);
    const setupSignIn = await signIn({
      businessId: setupBusinessId,
      username: setupUsername,
      password: setupPassword,
    });
    assert.equal(setupSignIn.session.user.role, "admin");
    trackRateLimitKey("admin-email-verify-global", "all");
    trackRateLimitKey("admin-email-verify", setupVerificationToken);
    await assert.rejects(
      verifyAdminEmail(setupVerificationToken),
      (error) => error instanceof AuthServiceError && error.code === "invalid_verification_token",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBootstrapSecret === undefined) {
      delete process.env.ADMIN_BOOTSTRAP_SECRET;
    } else {
      process.env.ADMIN_BOOTSTRAP_SECRET = originalBootstrapSecret;
    }
    for (const id of [businessId, setupBusinessId]) {
      if (id) {
        await pool.query("DELETE FROM audit_logs WHERE business_id = $1", [id]);
        await pool.query("DELETE FROM business_manager_permissions WHERE business_id = $1", [id]);
        await pool.query("DELETE FROM users WHERE business_id = $1", [id]);
        await pool.query("DELETE FROM branches WHERE business_id = $1", [id]);
        await pool.query("DELETE FROM businesses WHERE id = $1", [id]);
      }
    }
    for (const keyHash of rateLimitKeys) {
      await pool.query("DELETE FROM auth_rate_limits WHERE key_hash = $1", [keyHash]);
    }
    await pool.end();
  }
});
