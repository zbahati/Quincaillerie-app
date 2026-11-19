import "server-only";

import type { PoolClient } from "pg";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import {
  type BranchDetailsInput,
  type BranchUpdateInput,
  type BusinessDetailsInput,
  type ManagerCreateInput,
  type ManagerPasswordResetInput,
  type ManagerPermissionUpdate,
  type ManagerUpdateInput,
} from "@/lib/server/schemas/identity";

import { hashPassword } from "../auth/crypto";
import { enforceAuthRateLimit } from "../auth/rate-limit";
import { getDatabasePool } from "../db/pool";
import { withTransaction } from "../db/transaction";
import { AuthServiceError } from "../auth/errors";
import {
  findBusinessById,
  lockActiveBusinessForAdministration,
  updateBusinessDetails as updateBusinessRecord,
} from "../repositories/businesses";
import {
  createBranch,
  findBranchForBusiness,
  listBranchesWithManagerCounts,
  updateBranchForBusiness,
} from "../repositories/branches";
import { recordAuditLog } from "../repositories/audit-logs";
import {
  listManagerPermissions,
  replaceManagerPermissions,
  seedDefaultManagerPermissions,
} from "../repositories/manager-permissions";
import {
  createManagerUser,
  findUserForBusiness,
  listManagersForBusiness,
  revokeBranchManagerSessions,
  updateManagerForBusiness,
  updateManagerPassword,
} from "../repositories/users";
import {
  revokeUserAuthSessions,
} from "../repositories/auth-sessions";
import { assertActiveBranchManagerCoverage } from "./auth";

function assertAdministrator(context: AuthenticatedContext): void {
  if (context.role !== "admin") {
    throw new AuthServiceError(
      403,
      "forbidden",
      "Only the Admin can manage business access.",
    );
  }
}

function isUsernameConflict(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "23505" &&
    "constraint" in cause &&
    cause.constraint === "users_business_username_idx"
  );
}

async function lockBusiness(
  client: PoolClient,
  businessId: string,
): Promise<void> {
  const locked = await lockActiveBusinessForAdministration(client, businessId);
  if (!locked) {
    throw new AuthServiceError(404, "business_not_found", "The business is unavailable.");
  }
}

function managerDto(manager: Awaited<ReturnType<typeof listManagersForBusiness>>[number]) {
  return {
    id: manager.id,
    username: manager.username,
    full_name: manager.fullName,
    branch_id: manager.branchId,
    branch_name: manager.branchName,
    is_active: manager.isActive,
    last_login_at: manager.lastLoginAt?.toISOString() ?? null,
    created_at: manager.createdAt.toISOString(),
  };
}

export async function getBusinessAdministration(context: AuthenticatedContext) {
  assertAdministrator(context);
  const business = await findBusinessById(getDatabasePool(), context.businessId);
  if (!business?.isActive) {
    throw new AuthServiceError(404, "business_not_found", "The business is unavailable.");
  }
  return {
    id: business.id,
    name: business.name,
    tax_id: business.taxId,
  };
}

export async function updateBusinessAdministration(
  context: AuthenticatedContext,
  input: BusinessDetailsInput,
) {
  assertAdministrator(context);
  const business = await withTransaction(async (client) => {
    await lockBusiness(client, context.businessId);
    const updated = await updateBusinessRecord(client, context.businessId, input);
    await recordAuditLog(client, {
      businessId: context.businessId,
      userId: context.userId,
      action: "business.details_updated",
      entityType: "business",
      entityId: context.businessId,
      details: { name: updated.name, tax_id: updated.taxId },
    });
    return updated;
  });
  return { id: business.id, name: business.name, tax_id: business.taxId };
}

export async function listBusinessBranches(context: AuthenticatedContext) {
  assertAdministrator(context);
  const branches = await listBranchesWithManagerCounts(
    getDatabasePool(),
    context.businessId,
  );
  return branches.map((branch) => ({
    id: branch.id,
    name: branch.name,
    address: branch.address,
    phone: branch.phone,
    is_active: branch.isActive,
    active_manager_count: branch.managerCount ?? 0,
  }));
}

export async function createBusinessBranch(
  context: AuthenticatedContext,
  input: BranchDetailsInput,
) {
  assertAdministrator(context);
  await enforceAuthRateLimit(
    "branch-create",
    `${context.businessId}:${context.userId}`,
    20,
    60 * 60,
  );
  const branch = await withTransaction(async (client) => {
    await lockBusiness(client, context.businessId);
    const created = await createBranch(client, context.businessId, input, false);
    await assertActiveBranchManagerCoverage(client, context.businessId);
    await recordAuditLog(client, {
      businessId: context.businessId,
      userId: context.userId,
      action: "branch.created",
      entityType: "branch",
      entityId: created.id,
      details: { name: created.name, initially_active: false },
    });
    return created;
  });
  return {
    id: branch.id,
    name: branch.name,
    address: branch.address,
    phone: branch.phone,
    is_active: branch.isActive,
    active_manager_count: 0,
  };
}

export async function updateBusinessBranch(
  context: AuthenticatedContext,
  branchId: string,
  input: BranchUpdateInput,
) {
  assertAdministrator(context);
  const updated = await withTransaction(async (client) => {
    await lockBusiness(client, context.businessId);
    const previous = await findBranchForBusiness(client, context.businessId, branchId);
    if (!previous) {
      throw new AuthServiceError(404, "branch_not_found", "The branch is unavailable.");
    }

    const branch = await updateBranchForBusiness(
      client,
      context.businessId,
      branchId,
      input,
    );
    if (!branch) {
      throw new AuthServiceError(404, "branch_not_found", "The branch is unavailable.");
    }
    await assertActiveBranchManagerCoverage(client, context.businessId);
    if (previous.isActive && !branch.isActive) {
      await revokeBranchManagerSessions(client, context.businessId, branchId);
    }
    await recordAuditLog(client, {
      businessId: context.businessId,
      userId: context.userId,
      action: "branch.updated",
      entityType: "branch",
      entityId: branch.id,
      details: {
        previous_active: previous.isActive,
        is_active: branch.isActive,
        name: branch.name,
      },
    });
    return branch;
  });
  const updatedBranch = {
    id: updated.id,
    name: updated.name,
    address: updated.address,
    phone: updated.phone,
    is_active: updated.isActive,
  };
  const currentBranches = await listBranchesWithManagerCounts(
    getDatabasePool(),
    context.businessId,
  );
  const branchWithCounts = currentBranches.find((branch) => branch.id === updated.id);
  if (!branchWithCounts) {
    throw new Error("PostgreSQL did not return the updated branch.");
  }
  return {
    ...updatedBranch,
    active_manager_count: branchWithCounts.managerCount ?? 0,
  };
}

export async function listBusinessManagers(context: AuthenticatedContext) {
  assertAdministrator(context);
  return (await listManagersForBusiness(getDatabasePool(), context.businessId)).map(managerDto);
}

export async function createBusinessManager(
  context: AuthenticatedContext,
  input: ManagerCreateInput,
) {
  assertAdministrator(context);
  await enforceAuthRateLimit(
    "manager-create-global",
    "all",
    100,
    60 * 60,
  );
  await enforceAuthRateLimit(
    "manager-create",
    `${context.businessId}:${context.userId}`,
    20,
    60 * 60,
  );
  const passwordHash = await hashPassword(input.password);
  let manager: Awaited<ReturnType<typeof createManagerUser>>;
  try {
    manager = await withTransaction(async (client) => {
      await lockBusiness(client, context.businessId);
      const branch = await findBranchForBusiness(
        client,
        context.businessId,
        input.branchId,
      );
      if (!branch) {
        throw new AuthServiceError(404, "branch_not_found", "Select an available branch.");
      }
      const created = await createManagerUser(client, {
        businessId: context.businessId,
        branchId: input.branchId,
        username: input.username,
        fullName: input.fullName,
        passwordHash,
      });
      await seedDefaultManagerPermissions(client, context.businessId);
      await assertActiveBranchManagerCoverage(client, context.businessId);
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "manager.created",
        entityType: "user",
        entityId: created.id,
        details: { branch_id: branch.id, username: created.username },
      });
      return created;
    });
  } catch (cause) {
    if (isUsernameConflict(cause)) {
      throw new AuthServiceError(
        409,
        "username_taken",
        "That username is already in use for this business.",
      );
    }
    throw cause;
  }
  const fullRecord = (await listManagersForBusiness(
    getDatabasePool(),
    context.businessId,
  )).find((candidate) => candidate.id === manager.id);
  if (!fullRecord) {
    throw new Error("PostgreSQL did not return the created Manager.");
  }
  return managerDto(fullRecord);
}

export async function updateBusinessManager(
  context: AuthenticatedContext,
  managerId: string,
  input: ManagerUpdateInput,
) {
  assertAdministrator(context);
  const updated = await withTransaction(async (client) => {
    await lockBusiness(client, context.businessId);
    const previous = await findUserForBusiness(client, context.businessId, managerId);
    if (!previous || previous.role !== "manager") {
      throw new AuthServiceError(404, "manager_not_found", "The Manager is unavailable.");
    }
    if (input.branchId !== undefined) {
      const branch = await findBranchForBusiness(client, context.businessId, input.branchId);
      if (!branch) {
        throw new AuthServiceError(404, "branch_not_found", "Select an available branch.");
      }
    }

    const manager = await updateManagerForBusiness(
      client,
      context.businessId,
      managerId,
      input,
    );
    if (!manager) {
      throw new AuthServiceError(404, "manager_not_found", "The Manager is unavailable.");
    }
    await assertActiveBranchManagerCoverage(client, context.businessId);
    if (
      previous.branchId !== manager.branchId ||
      (previous.isActive && !manager.isActive)
    ) {
      await revokeUserAuthSessions(client, context.businessId, managerId);
    }
    await recordAuditLog(client, {
      businessId: context.businessId,
      userId: context.userId,
      action: "manager.updated",
      entityType: "user",
      entityId: manager.id,
      details: {
        previous_branch_id: previous.branchId,
        branch_id: manager.branchId,
        previous_active: previous.isActive,
        is_active: manager.isActive,
        previous_full_name: previous.fullName,
        full_name: manager.fullName,
      },
    });
    return manager;
  });
  const fullRecord = (await listManagersForBusiness(
    getDatabasePool(),
    context.businessId,
  )).find((candidate) => candidate.id === updated.id);
  if (!fullRecord) {
    throw new Error("PostgreSQL did not return the updated Manager.");
  }
  return managerDto(fullRecord);
}

export async function resetBusinessManagerPassword(
  context: AuthenticatedContext,
  managerId: string,
  input: ManagerPasswordResetInput,
): Promise<void> {
  assertAdministrator(context);
  await enforceAuthRateLimit(
    "manager-password-reset-global",
    "all",
    100,
    60 * 60,
  );
  await enforceAuthRateLimit(
    "manager-password-reset",
    `${context.businessId}:${managerId}`,
    5,
    60 * 60,
  );
  const passwordHash = await hashPassword(input.password);
  await withTransaction(async (client) => {
    await lockBusiness(client, context.businessId);
    const manager = await findUserForBusiness(client, context.businessId, managerId);
    if (!manager || manager.role !== "manager") {
      throw new AuthServiceError(404, "manager_not_found", "The Manager is unavailable.");
    }
    if (!(await updateManagerPassword(client, context.businessId, managerId, passwordHash))) {
      throw new AuthServiceError(404, "manager_not_found", "The Manager is unavailable.");
    }
    await revokeUserAuthSessions(client, context.businessId, managerId);
    await recordAuditLog(client, {
      businessId: context.businessId,
      userId: context.userId,
      action: "manager.password_reset",
      entityType: "user",
      entityId: managerId,
    });
  });
}

export async function getBusinessManagerPermissions(context: AuthenticatedContext) {
  assertAdministrator(context);
  return listManagerPermissions(getDatabasePool(), context.businessId);
}

export async function updateBusinessManagerPermissions(
  context: AuthenticatedContext,
  grants: ManagerPermissionUpdate,
) {
  assertAdministrator(context);
  return withTransaction(async (client) => {
    await lockBusiness(client, context.businessId);
    await replaceManagerPermissions(
      client,
      context.businessId,
      context.userId,
      grants,
    );
    await recordAuditLog(client, {
      businessId: context.businessId,
      userId: context.userId,
      action: "manager.permissions_updated",
      entityType: "business",
      entityId: context.businessId,
      details: {
        grants: grants.map((grant) => ({
          permission_id: grant.permissionId,
          enabled: grant.enabled,
        })),
      },
    });
    return listManagerPermissions(client, context.businessId);
  });
}

