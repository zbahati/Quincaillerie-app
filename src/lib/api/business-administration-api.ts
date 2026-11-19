import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface AdminBusiness {
  id: string;
  name: string;
  tax_id: string | null;
}

export interface AdminBranch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  active_manager_count: number;
}

export interface AdminManager {
  id: string;
  username: string;
  full_name: string;
  branch_id: string;
  branch_name: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface ManagerPermissionSetting {
  permissionId: string;
  description: string;
  enabled: boolean;
  enabledByDefault: boolean;
}

function parseBusiness(value: unknown): AdminBusiness {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    (value.tax_id !== null && typeof value.tax_id !== "string")
  ) {
    throw invalidResponse("The service returned invalid business details.");
  }
  return { id: value.id, name: value.name, tax_id: value.tax_id };
}

function parseBranch(value: unknown): AdminBranch {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    (value.address !== null && typeof value.address !== "string") ||
    (value.phone !== null && typeof value.phone !== "string") ||
    typeof value.is_active !== "boolean" ||
    typeof value.active_manager_count !== "number"
  ) {
    throw invalidResponse("The service returned invalid branch details.");
  }
  return {
    id: value.id,
    name: value.name,
    address: value.address,
    phone: value.phone,
    is_active: value.is_active,
    active_manager_count: value.active_manager_count,
  };
}

function parseBranches(value: unknown): AdminBranch[] {
  if (!isRecord(value) || !Array.isArray(value.branches)) {
    throw invalidResponse("The service returned invalid branch information.");
  }
  return value.branches.map(parseBranch);
}

function parseManager(value: unknown): AdminManager {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.username !== "string" ||
    typeof value.full_name !== "string" ||
    typeof value.branch_id !== "string" ||
    typeof value.branch_name !== "string" ||
    typeof value.is_active !== "boolean" ||
    (value.last_login_at !== null && typeof value.last_login_at !== "string") ||
    typeof value.created_at !== "string"
  ) {
    throw invalidResponse("The service returned invalid Manager details.");
  }
  return {
    id: value.id,
    username: value.username,
    full_name: value.full_name,
    branch_id: value.branch_id,
    branch_name: value.branch_name,
    is_active: value.is_active,
    last_login_at: value.last_login_at,
    created_at: value.created_at,
  };
}

function parseManagers(value: unknown): AdminManager[] {
  if (!isRecord(value) || !Array.isArray(value.managers)) {
    throw invalidResponse("The service returned invalid Manager information.");
  }
  return value.managers.map(parseManager);
}

function parsePermissions(value: unknown): ManagerPermissionSetting[] {
  if (!isRecord(value) || !Array.isArray(value.permissions)) {
    throw invalidResponse("The service returned invalid Manager permissions.");
  }
  return value.permissions.map((permission) => {
    if (
      !isRecord(permission) ||
      typeof permission.permissionId !== "string" ||
      typeof permission.description !== "string" ||
      typeof permission.enabled !== "boolean" ||
      typeof permission.enabledByDefault !== "boolean"
    ) {
      throw invalidResponse("The service returned an invalid Manager permission.");
    }
    return {
      permissionId: permission.permissionId,
      description: permission.description,
      enabled: permission.enabled,
      enabledByDefault: permission.enabledByDefault,
    };
  });
}

function parseSingle<T>(value: unknown, key: string, parser: (input: unknown) => T): T {
  if (!isRecord(value) || !(key in value)) {
    throw invalidResponse("The service returned an invalid administration response.");
  }
  return parser(value[key]);
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  return requestJson(path, { method: "POST", body: JSON.stringify(body) });
}

async function patchJson(path: string, body: unknown): Promise<unknown> {
  return requestJson(path, { method: "PATCH", body: JSON.stringify(body) });
}

async function putJson(path: string, body: unknown): Promise<unknown> {
  return requestJson(path, { method: "PUT", body: JSON.stringify(body) });
}

export const businessAdministrationApi = {
  async business(): Promise<AdminBusiness> {
    return parseSingle(await requestJson("/api/admin/business"), "business", parseBusiness);
  },

  async updateBusiness(input: { name: string; taxId: string | null }): Promise<AdminBusiness> {
    return parseSingle(
      await patchJson("/api/admin/business", input),
      "business",
      parseBusiness,
    );
  },

  async branches(): Promise<AdminBranch[]> {
    return parseBranches(await requestJson("/api/admin/branches"));
  },

  async createBranch(input: {
    name: string;
    address: string | null;
    phone: string | null;
  }): Promise<AdminBranch> {
    return parseSingle(await postJson("/api/admin/branches", input), "branch", parseBranch);
  },

  async updateBranch(
    branchId: string,
    input: { name?: string; address?: string | null; phone?: string | null; isActive?: boolean },
  ): Promise<AdminBranch> {
    return parseSingle(
      await patchJson(`/api/admin/branches/${encodeURIComponent(branchId)}`, input),
      "branch",
      parseBranch,
    );
  },

  async managers(): Promise<AdminManager[]> {
    return parseManagers(await requestJson("/api/admin/managers"));
  },

  async createManager(input: {
    branchId: string;
    username: string;
    fullName: string;
    password: string;
  }): Promise<AdminManager> {
    return parseSingle(await postJson("/api/admin/managers", input), "manager", parseManager);
  },

  async updateManager(
    managerId: string,
    input: { branchId?: string; isActive?: boolean; fullName?: string },
  ): Promise<AdminManager> {
    return parseSingle(
      await patchJson(`/api/admin/managers/${encodeURIComponent(managerId)}`, input),
      "manager",
      parseManager,
    );
  },

  async resetManagerPassword(managerId: string, password: string): Promise<void> {
    await putJson(
      `/api/admin/managers/${encodeURIComponent(managerId)}`,
      { password },
    );
  },

  async managerPermissions(): Promise<ManagerPermissionSetting[]> {
    return parsePermissions(await requestJson("/api/admin/manager-permissions"));
  },

  async updateManagerPermissions(
    grants: Array<{ permissionId: string; enabled: boolean }>,
  ): Promise<ManagerPermissionSetting[]> {
    return parsePermissions(
      await putJson("/api/admin/manager-permissions", grants),
    );
  },
};
