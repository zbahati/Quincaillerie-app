import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import {
  type BrandCreateInput,
  type CategoryCreateInput,
  type UnitCreateInput,
} from "@/lib/server/schemas/catalog";

import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { withTransaction } from "../db/transaction";
import { recordAuditLog } from "../repositories/audit-logs";
import {
  createBrand,
  createCategory,
  createUnit,
  findCategory,
  listBrands,
  listCategories,
  listUnits,
} from "../repositories/catalog";
import { requirePermission } from "../auth/authorization";

function isUniqueViolation(cause: unknown, constraint: string): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "23505" &&
    "constraint" in cause &&
    cause.constraint === constraint
  );
}

function raiseDuplicate(cause: unknown, code: string, message: string): never {
  if (isUniqueViolation(cause, code)) {
    throw new AuthServiceError(409, code, message);
  }
  throw cause;
}

export async function listBusinessCategories(context: AuthenticatedContext) {
  requirePermission(context, "catalog.read");
  return listCategories(getDatabasePool(), context.businessId);
}

export async function createBusinessCategory(
  context: AuthenticatedContext,
  input: CategoryCreateInput,
) {
  requirePermission(context, "catalog.manage");
  const pool = getDatabasePool();
  if (input.parentId && !(await findCategory(pool, context.businessId, input.parentId))) {
    throw new AuthServiceError(
      400,
      "invalid_parent_category",
      "The parent category must belong to this business.",
    );
  }

  try {
    return await withTransaction(async (client) => {
      const category = await createCategory(client, context.businessId, input);
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "catalog.category_created",
        entityType: "category",
        entityId: category.id,
        details: { name: category.name, parent_id: category.parentId },
      });
      return category;
    });
  } catch (cause) {
    raiseDuplicate(
      cause,
      "categories_unique_name_idx",
      "A category with this name already exists under that parent.",
    );
  }
}

export async function listBusinessBrands(context: AuthenticatedContext) {
  requirePermission(context, "catalog.read");
  return listBrands(getDatabasePool(), context.businessId);
}

export async function createBusinessBrand(
  context: AuthenticatedContext,
  input: BrandCreateInput,
) {
  requirePermission(context, "catalog.manage");
  try {
    return await withTransaction(async (client) => {
      const brand = await createBrand(client, context.businessId, input);
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "catalog.brand_created",
        entityType: "brand",
        entityId: brand.id,
        details: { name: brand.name },
      });
      return brand;
    });
  } catch (cause) {
    raiseDuplicate(cause, "brands_unique_name_idx", "This brand already exists.");
  }
}

export async function listBusinessUnits(context: AuthenticatedContext) {
  requirePermission(context, "catalog.read");
  return listUnits(getDatabasePool(), context.businessId);
}

export async function createBusinessUnit(
  context: AuthenticatedContext,
  input: UnitCreateInput,
) {
  requirePermission(context, "catalog.manage");
  try {
    return await withTransaction(async (client) => {
      const unit = await createUnit(client, context.businessId, input);
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "catalog.unit_created",
        entityType: "unit",
        entityId: unit.id,
        details: { code: unit.code, name: unit.name, decimals_ok: unit.decimalsOk },
      });
      return unit;
    });
  } catch (cause) {
    raiseDuplicate(cause, "units_unique_code_idx", "This unit code already exists.");
  }
}
