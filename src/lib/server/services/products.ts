import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import {
  type ProductCreateInput,
  type ProductListQuery,
  type ProductSellingPriceUpdateInput,
  type ProductUnitCreateInput,
} from "@/lib/server/schemas/products";

import { requirePermission } from "../auth/authorization";
import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { withTransaction } from "../db/transaction";
import { recordAuditLog } from "../repositories/audit-logs";
import {
  createProduct,
  createProductUnit,
  findAvailableProductReferences,
  findProduct,
  listProducts,
  listProductUnits,
  ProductRuleError,
  updateBaseSellingPrice,
} from "../repositories/products";

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

function raiseDuplicate(cause: unknown, constraint: string, code: string, message: string): never {
  if (isUniqueViolation(cause, constraint)) {
    throw new AuthServiceError(409, code, message);
  }
  throw cause;
}

function raiseProductRule(cause: unknown): never {
  if (cause instanceof ProductRuleError) {
    throw new AuthServiceError(cause.status, cause.code, cause.message);
  }
  throw cause;
}

export async function listBusinessProducts(
  context: AuthenticatedContext,
  query: ProductListQuery,
) {
  requirePermission(context, "catalog.read");
  return listProducts(getDatabasePool(), context.businessId, query);
}

export async function createBusinessProduct(
  context: AuthenticatedContext,
  input: ProductCreateInput,
) {
  requirePermission(context, "catalog.manage");
  if (input.sellingPrice < input.purchasePrice) {
    throw new AuthServiceError(
      400,
      "selling_price_below_cost",
      "The selling price must not be below the product's purchase cost.",
    );
  }

  try {
    return await withTransaction(async (client) => {
      const references = await findAvailableProductReferences(
        client,
        context.businessId,
        input,
      );
      if (!references.categoryAvailable) {
        throw new AuthServiceError(
          400,
          "invalid_category",
          "The category must be active and belong to this business.",
        );
      }
      if (!references.brandAvailable) {
        throw new AuthServiceError(
          400,
          "invalid_brand",
          "The brand must be active and belong to this business.",
        );
      }
      if (!references.unitAvailable) {
        throw new AuthServiceError(
          400,
          "invalid_base_unit",
          "The base unit must be active and available to this business.",
        );
      }

      const product = await createProduct(
        client,
        context.businessId,
        context.userId,
        input,
      );
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "catalog.product_created",
        entityType: "product",
        entityId: product.id,
        details: { name: product.name, sku: product.sku },
      });
      return product;
    });
  } catch (cause) {
    raiseDuplicate(
      cause,
      "products_business_sku_idx",
      "duplicate_product_sku",
      "A product with this SKU already exists in this business.",
    );
  }
}

export async function listBusinessProductUnits(
  context: AuthenticatedContext,
  productId: string,
) {
  requirePermission(context, "catalog.read");
  const pool = getDatabasePool();
  if (!(await findProduct(pool, context.businessId, productId))) {
    throw new AuthServiceError(404, "product_not_found", "The product is unavailable to this business.");
  }
  return listProductUnits(pool, context.businessId, productId);
}

export async function createBusinessProductUnit(
  context: AuthenticatedContext,
  productId: string,
  input: ProductUnitCreateInput,
) {
  requirePermission(context, "catalog.manage");
  try {
    return await withTransaction(async (client) => {
      const unit = await createProductUnit(
        client,
        context.businessId,
        context.userId,
        productId,
        input,
      );
      await recordAuditLog(client, {
        businessId: context.businessId,
        userId: context.userId,
        action: "catalog.product_selling_unit_created",
        entityType: "product_unit",
        entityId: unit.id,
        details: {
          product_id: productId,
          unit_id: unit.unitId,
          conversion_factor: unit.conversionFactor,
          selling_price: unit.sellingPrice,
        },
      });
      return unit;
    });
  } catch (cause) {
    if (cause instanceof ProductRuleError) {
      raiseProductRule(cause);
    }
    raiseDuplicate(
      cause,
      "product_units_product_id_unit_id_key",
      "duplicate_product_unit",
      "This selling unit is already configured for the product.",
    );
  }
}

export async function updateBusinessProductSellingPrice(
  context: AuthenticatedContext,
  productId: string,
  input: ProductSellingPriceUpdateInput,
) {
  requirePermission(context, "catalog.manage");
  try {
    return await withTransaction(async (client) => {
      const result = await updateBaseSellingPrice(
        client,
        context.businessId,
        productId,
        input.sellingPrice,
        context.userId,
      );
      if (result.changed) {
        await recordAuditLog(client, {
          businessId: context.businessId,
          userId: context.userId,
          action: "catalog.product_base_selling_price_updated",
          entityType: "product",
          entityId: productId,
          details: {
            selling_price: result.product.sellingPrice,
            base_unit_id: result.product.baseUnitId,
          },
        });
      }
      return result.product;
    });
  } catch (cause) {
    raiseProductRule(cause);
  }
}
