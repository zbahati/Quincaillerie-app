import "server-only";

import type {
  AdminBootstrapInput,
  AdminPasswordResetCompletionInput,
  AdminPasswordResetRequestInput,
  SignInInput,
} from "@/lib/server/schemas/identity";
import type { AuthSession, AuthUser } from "@/lib/api/auth-api";

import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  verifyPasswordOrDummy,
} from "../auth/crypto";
import {
  deliverPasswordResetEmail,
  deliverVerificationEmail,
} from "../auth/email";
import { AuthServiceError } from "../auth/errors";
import { enforceAuthRateLimit } from "../auth/rate-limit";
import { getDatabasePool } from "../db/pool";
import { withTransaction } from "../db/transaction";
import {
  findActiveBranchesWithoutManagers,
} from "../repositories/branches";
import {
  createBusiness,
  lockActiveBusinessForSignIn,
  listAuthBusinessStatuses,
} from "../repositories/businesses";
import {
  createAuthSession,
  findActiveAuthSession,
  recordSuccessfulLogin,
  revokeAuthSession,
  revokeUserAuthSessions,
} from "../repositories/auth-sessions";
import {
  createAdminEmailVerificationToken,
  createAdminPasswordResetToken,
  completeAdminPasswordReset as completePasswordResetToken,
  findUnverifiedAdminByEmail,
  findVerifiedAdminByEmail,
  verifyAdminEmail as consumeVerificationToken,
} from "../repositories/auth-tokens";
import { recordAuditLog } from "../repositories/audit-logs";
import { listPermissionsForUser } from "../repositories/permissions";
import type { PgExecutor } from "../repositories/businesses";
import {
  businessHasAdmin,
  createAdminUser,
  findAuthCredentials,
} from "../repositories/users";
import { seedDefaultManagerPermissions } from "../repositories/manager-permissions";

const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1_000;
const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1_000;
const BOOTSTRAP_ADVISORY_LOCK = 7_412_908;

export interface AdminBootstrapResult {
  status: "verification_pending";
  business_id: string;
  email_delivery: "sent" | "failed";
}

export interface AuthenticatedSignIn {
  session: AuthSession;
  sessionToken: string;
  expiresAt: Date;
}

function toApiUser(user: {
  id: string;
  businessId: string;
  username: string;
  fullName: string;
  role: AuthUser["role"];
  branchId: string | null;
}): AuthUser {
  return {
    id: user.id,
    business_id: user.businessId,
    username: user.username,
    full_name: user.fullName,
    role: user.role,
    branch_id: user.branchId,
  };
}

function toApiSession(
  user: Parameters<typeof toApiUser>[0],
  permissions: string[],
): AuthSession {
  return { user: toApiUser(user), permissions };
}

function logEmailDeliveryFailure(action: string, cause: unknown): void {
  const code = cause instanceof AuthServiceError ? cause.code : "unexpected_error";
  console.error(`Auth email delivery failed (${action}, ${code}).`);
}

export async function listBusinesses() {
  const records = await listAuthBusinessStatuses(getDatabasePool());
  return records.map((business) => ({
    id: business.id,
    name: business.name,
    requires_admin_setup: business.requiresAdminSetup,
    requires_admin_verification: business.requiresAdminVerification,
  }));
}

export async function bootstrapAdmin(
  input: AdminBootstrapInput,
): Promise<AdminBootstrapResult> {
  await enforceAuthRateLimit("admin-bootstrap-global", "all", 20, 60 * 60);
  await enforceAuthRateLimit(
    "admin-bootstrap",
    `${input.businessId ?? "new"}:${input.email}`,
    5,
    60 * 60,
  );
  const passwordHash = await hashPassword(input.password);
  const token = createOpaqueToken();

  const admin = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [BOOTSTRAP_ADVISORY_LOCK]);

    let businessId = input.businessId;
    if (businessId === null) {
      const existingBusiness = await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM businesses) AS exists",
      );
      if (existingBusiness.rows[0]?.exists) {
        throw new AuthServiceError(
          409,
          "business_selection_required",
          "Select an existing business to finish Admin setup.",
        );
      }
      if (!input.businessName) {
        throw new AuthServiceError(400, "invalid_input", "A business name is required.");
      }
      const business = await createBusiness(client, { name: input.businessName });
      businessId = business.id;
    } else {
      const business = await client.query<{ isActive: boolean }>(
        "SELECT is_active AS \"isActive\" FROM businesses WHERE id = $1 FOR UPDATE",
        [businessId],
      );
      if (!business.rows[0]?.isActive) {
        throw new AuthServiceError(404, "business_not_found", "The selected business is unavailable.");
      }
    }

    if (await businessHasAdmin(client, businessId)) {
      throw new AuthServiceError(
        409,
        "admin_already_exists",
        "An Admin account has already been created for this business.",
      );
    }

    await seedDefaultManagerPermissions(client, businessId);
    const user = await createAdminUser(client, {
      businessId,
      username: input.username,
      fullName: input.fullName,
      email: input.email,
      passwordHash,
    });
    await createAdminEmailVerificationToken(client, {
      businessId,
      userId: user.id,
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
    });
    await recordAuditLog(client, {
      businessId,
      userId: user.id,
      action: "auth.admin_bootstrapped",
      entityType: "user",
      entityId: user.id,
    });
    return {
      businessId,
      email: input.email,
      fullName: user.fullName,
    };
  });

  try {
    await deliverVerificationEmail(admin.email, admin.fullName, token);
    return {
      status: "verification_pending",
      business_id: admin.businessId,
      email_delivery: "sent",
    };
  } catch (cause) {
    logEmailDeliveryFailure("admin-bootstrap", cause);
    return {
      status: "verification_pending",
      business_id: admin.businessId,
      email_delivery: "failed",
    };
  }
}

export async function requestAdminEmailVerification(
  businessId: string,
  email: string,
): Promise<void> {
  await enforceAuthRateLimit("admin-verification-global", "all", 100, 15 * 60);
  await enforceAuthRateLimit(
    "admin-verification",
    `${businessId}:${email}`,
    5,
    15 * 60,
  );
  const admin = await findUnverifiedAdminByEmail(getDatabasePool(), businessId, email);
  if (!admin) {
    return;
  }

  const token = createOpaqueToken();
  await withTransaction(async (client) => {
    await createAdminEmailVerificationToken(client, {
      businessId: admin.businessId,
      userId: admin.userId,
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
    });
    await recordAuditLog(client, {
      businessId: admin.businessId,
      userId: admin.userId,
      action: "auth.admin_verification_requested",
      entityType: "user",
      entityId: admin.userId,
    });
  });

  try {
    await deliverVerificationEmail(admin.email, admin.fullName, token);
  } catch (cause) {
    logEmailDeliveryFailure("admin-verification", cause);
  }
}

export async function verifyAdminEmail(token: string): Promise<void> {
  await enforceAuthRateLimit("admin-email-verify-global", "all", 100, 15 * 60);
  await enforceAuthRateLimit("admin-email-verify", token, 10, 15 * 60);
  const identity = await withTransaction(async (client) => {
    const verified = await consumeVerificationToken(client, hashOpaqueToken(token));
    if (!verified) {
      return null;
    }
    await recordAuditLog(client, {
      businessId: verified.businessId,
      userId: verified.userId,
      action: "auth.admin_email_verified",
      entityType: "user",
      entityId: verified.userId,
    });
    return verified;
  });
  if (!identity) {
    throw new AuthServiceError(
      400,
      "invalid_verification_token",
      "This email verification link is invalid, expired, or already used.",
    );
  }
}

export async function signIn(input: SignInInput): Promise<AuthenticatedSignIn> {
  await enforceAuthRateLimit("sign-in-global", "all", 120, 60);
  await enforceAuthRateLimit(
    "sign-in",
    `${input.businessId}:${input.username}`,
    10,
    15 * 60,
  );
  const pool = getDatabasePool();
  const credentials = await findAuthCredentials(pool, input.businessId, input.username);
  let passwordMatches: boolean;
  try {
    passwordMatches = await verifyPasswordOrDummy(
      input.password,
      credentials?.passwordHash ?? null,
    );
  } catch {
    console.error("Stored password hash could not be verified.");
    throw new AuthServiceError(
      500,
      "credential_verification_failed",
      "The sign-in service could not verify this account. Contact the application administrator.",
    );
  }

  if (
    !credentials ||
    !passwordMatches ||
    !credentials.isActive ||
    !credentials.businessIsActive ||
    (credentials.role === "admin" && credentials.emailVerifiedAt === null) ||
    (credentials.role === "manager" && credentials.branchIsActive !== true)
  ) {
    throw new AuthServiceError(
      401,
      "invalid_credentials",
      "Business, username or password is incorrect.",
    );
  }

  const sessionToken = createOpaqueToken();
  const expiresAt = new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1_000);
  const session = await withTransaction(async (client) => {
    const businessIsActive = await lockActiveBusinessForSignIn(
      client,
      credentials.businessId,
    );
    if (!businessIsActive) {
      throw new AuthServiceError(
        401,
        "invalid_credentials",
        "Business, username or password is incorrect.",
      );
    }
    const stillActive = await recordSuccessfulLogin(
      client,
      credentials.businessId,
      credentials.id,
      credentials.passwordHash,
    );
    if (!stillActive) {
      throw new AuthServiceError(
        401,
        "invalid_credentials",
        "Business, username or password is incorrect.",
      );
    }
    await createAuthSession(client, {
      businessId: credentials.businessId,
      userId: credentials.id,
      tokenHash: hashOpaqueToken(sessionToken),
      expiresAt,
    });
    await recordAuditLog(client, {
      businessId: credentials.businessId,
      userId: credentials.id,
      action: "auth.user_signed_in",
      entityType: "user",
      entityId: credentials.id,
    });
    const permissions = await listPermissionsForUser(
      client,
      credentials.businessId,
      credentials.role,
    );
    return toApiSession(credentials, permissions);
  });

  return { session, sessionToken, expiresAt };
}

export async function currentSession(sessionToken: string | null): Promise<AuthSession | null> {
  if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) {
    return null;
  }
  const pool = getDatabasePool();
  const active = await findActiveAuthSession(pool, hashOpaqueToken(sessionToken));
  if (!active) {
    return null;
  }
  const permissions = await listPermissionsForUser(pool, active.businessId, active.role);
  return toApiSession({ ...active, id: active.userId }, permissions);
}

export async function signOut(sessionToken: string | null): Promise<void> {
  if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) {
    return;
  }
  const pool = getDatabasePool();
  const tokenHash = hashOpaqueToken(sessionToken);
  const active = await findActiveAuthSession(pool, tokenHash);
  if (!active) {
    return;
  }
  await withTransaction(async (client) => {
    const revoked = await revokeAuthSession(client, tokenHash);
    if (revoked) {
      await recordAuditLog(client, {
        businessId: active.businessId,
        userId: active.userId,
        action: "auth.user_signed_out",
        entityType: "user",
        entityId: active.userId,
      });
    }
  });
}

export async function requestAdminPasswordReset(
  input: AdminPasswordResetRequestInput,
): Promise<void> {
  await enforceAuthRateLimit("admin-password-reset-global", "all", 100, 15 * 60);
  await enforceAuthRateLimit(
    "admin-password-reset",
    `${input.businessId}:${input.email}`,
    5,
    15 * 60,
  );
  const admin = await findVerifiedAdminByEmail(
    getDatabasePool(),
    input.businessId,
    input.email,
  );
  if (!admin) {
    return;
  }

  const token = createOpaqueToken();
  await withTransaction(async (client) => {
    await createAdminPasswordResetToken(client, {
      businessId: admin.businessId,
      userId: admin.userId,
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
    });
    await recordAuditLog(client, {
      businessId: admin.businessId,
      userId: admin.userId,
      action: "auth.admin_password_reset_requested",
      entityType: "user",
      entityId: admin.userId,
    });
  });

  try {
    await deliverPasswordResetEmail(admin.email, admin.fullName, token);
  } catch (cause) {
    logEmailDeliveryFailure("admin-password-reset", cause);
  }
}

export async function completeAdminPasswordReset(
  input: AdminPasswordResetCompletionInput,
): Promise<void> {
  await enforceAuthRateLimit("admin-password-reset-complete-global", "all", 100, 15 * 60);
  await enforceAuthRateLimit("admin-password-reset-complete", input.token, 10, 15 * 60);
  const passwordHash = await hashPassword(input.newPassword);
  const identity = await withTransaction(async (client) => {
    const reset = await completePasswordResetToken(
      client,
      hashOpaqueToken(input.token),
      passwordHash,
    );
    if (!reset) {
      return null;
    }
    await revokeUserAuthSessions(client, reset.businessId, reset.userId);
    await recordAuditLog(client, {
      businessId: reset.businessId,
      userId: reset.userId,
      action: "auth.admin_password_reset_completed",
      entityType: "user",
      entityId: reset.userId,
    });
    return reset;
  });
  if (!identity) {
    throw new AuthServiceError(
      400,
      "invalid_reset_token",
      "This password reset link is invalid, expired, or already used.",
    );
  }
}

export async function assertActiveBranchManagerCoverage(
  executor: PgExecutor,
  businessId: string,
): Promise<void> {
  const uncoveredBranches = await findActiveBranchesWithoutManagers(
    executor,
    businessId,
  );
  if (uncoveredBranches.length > 0) {
    throw new AuthServiceError(
      409,
      "branch_manager_required",
      "Every active branch must have at least one active Manager.",
    );
  }
}

