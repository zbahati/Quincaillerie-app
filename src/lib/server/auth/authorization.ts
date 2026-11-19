import "server-only";

import type { AuthRole } from "@/lib/api/auth-api";
import { getDatabasePool } from "@/lib/server/db/pool";
import { listPermissionsForUser } from "@/lib/server/repositories/permissions";
import {
  findActiveAuthSession,
  type ActiveAuthSessionRecord,
} from "@/lib/server/repositories/auth-sessions";

import { hashOpaqueToken } from "./crypto";
import { AuthServiceError } from "./errors";

export interface AuthenticatedContext extends ActiveAuthSessionRecord {
  permissions: string[];
}

export async function findAuthenticatedContext(
  sessionToken: string | null,
): Promise<AuthenticatedContext | null> {
  if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) {
    return null;
  }
  const pool = getDatabasePool();
  const session = await findActiveAuthSession(pool, hashOpaqueToken(sessionToken));
  if (!session) {
    return null;
  }
  return {
    ...session,
    permissions: await listPermissionsForUser(pool, session.businessId, session.role),
  };
}

export function requirePermission(
  context: AuthenticatedContext,
  permissionId: string,
): void {
  if (context.role !== "admin" && !context.permissions.includes(permissionId)) {
    throw new AuthServiceError(
      403,
      "forbidden",
      "You do not have permission to perform this action.",
    );
  }
}

export function requireBusinessScope(
  context: AuthenticatedContext,
  businessId: string,
  branchId?: string | null,
): void {
  if (context.businessId !== businessId) {
    throw new AuthServiceError(403, "forbidden", "You cannot access this business.");
  }
  if (
    context.role === "manager" &&
    (branchId === undefined || branchId !== context.branchId)
  ) {
    throw new AuthServiceError(403, "forbidden", "You cannot access this branch.");
  }
}

export function isAuthRole(value: string): value is AuthRole {
  return value === "admin" || value === "manager";
}
