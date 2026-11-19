import "server-only";

import type { Pool, PoolClient } from "pg";

import type {
  ProductCreateInput,
  ProductListQuery,
  ProductUnitCreateInput,
} from "@/lib/server/schemas/products";

export type ProductExecutor = Pool | PoolClient;

export class ProductRuleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductRuleError";
  }
}

export interface ProductRecord {
  id: string;
  businessId: string;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  name: string;
  sku: string;
  barcode: string | null;
  description: string | null;
  sizeDimensions: string | null;
  colour: string | null;
  baseUnitId: string;
  baseUnitName: string;
  baseUnitCode: string;
  purchasePrice: number;
  sellingPrice: number;
  minStockQuantity: number;
  vatClass: string;
  isActive: boolean;
}

export interface ProductPageRecord {
  items: ProductRecord[];
  totalCount: number;
}

export interface ProductUnitRecord {
  id: string;
  productId: string;
  unitId: string;
  unitName: string;
  unitCode: string;
  conversionFactor: number;
  isBase: boolean;
  sellingPrice: number | null;
}

interface ProductRow extends Omit<
  ProductRecord,
  "purchasePrice" | "sellingPrice" | "minStockQuantity"
> {
  purchasePrice: string;
  sellingPrice: string;
  minStockQuantity: string;
}

interface ProductUnitRow extends Omit<ProductUnitRecord, "conversionFactor" | "sellingPrice"> {
  conversionFactor: string;
  sellingPrice: string | null;
}

function safeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`The stored ${field} exceeds the browser's safe integer range.`);
  }
  return parsed;
}

function mapProduct(row: ProductRow): ProductRecord {
  return {
    ...row,
    purchasePrice: safeInteger(row.purchasePrice, "purchase price"),
    sellingPrice: safeInteger(row.sellingPrice, "selling price"),
    minStockQuantity: safeInteger(row.minStockQuantity, "minimum stock quantity"),
  };
}

function mapProductUnit(row: ProductUnitRow): ProductUnitRecord {
  return {
    ...row,
    conversionFactor: safeInteger(row.conversionFactor, "unit conversion factor"),
    sellingPrice: row.sellingPrice === null
      ? null
      : safeInteger(row.sellingPrice, "unit selling price"),
  };
}

const PRODUCT_COLUMNS = `
  p.id,
  p.business_id AS "businessId",
  p.category_id AS "categoryId",
  c.name AS "categoryName",
  p.brand_id AS "brandId",
  b.name AS "brandName",
  p.name,
  p.sku,
  p.barcode,
  p.description,
  p.size_dimensions AS "sizeDimensions",
  p.colour,
  p.base_unit_id AS "baseUnitId",
  u.name AS "baseUnitName",
  u.code AS "baseUnitCode",
  p.purchase_price::text AS "purchasePrice",
  p.selling_price::text AS "sellingPrice",
  p.min_stock_quantity::text AS "minStockQuantity",
  p.vat_class AS "vatClass",
  p.is_active AS "isActive"
`;

const PRODUCT_UNIT_COLUMNS = `
  pu.id,
  pu.product_id AS "productId",
  pu.unit_id AS "unitId",
  u.name AS "unitName",
  u.code AS "unitCode",
  pu.conversion_factor::text AS "conversionFactor",
  pu.is_base AS "isBase",
  pu.selling_price::text AS "sellingPrice"
`;

export async function listProducts(
  executor: ProductExecutor,
  businessId: string,
  query: ProductListQuery,
): Promise<ProductPageRecord> {
  const search = query.search?.trim() || null;
  const pattern = search
    ? `%${search.replace(/[!%_]/g, (character) => `!${character}`)}%`
    : null;
  const values = [businessId, pattern];
  const filter = `p.business_id = $1 AND (
    $2::text IS NULL OR
    p.name ILIKE $2 ESCAPE '!' OR
    p.sku ILIKE $2 ESCAPE '!' OR
    COALESCE(p.barcode, '') ILIKE $2 ESCAPE '!' OR
    COALESCE(p.description, '') ILIKE $2 ESCAPE '!' OR
    COALESCE(p.size_dimensions, '') ILIKE $2 ESCAPE '!' OR
    COALESCE(p.colour, '') ILIKE $2 ESCAPE '!' OR
    COALESCE(b.name, '') ILIKE $2 ESCAPE '!' OR
    COALESCE(c.name, '') ILIKE $2 ESCAPE '!'
  )`;

  const countResult = await executor.query<{ totalCount: string }>(
    `SELECT COUNT(*)::text AS "totalCount"
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
     LEFT JOIN brands b ON b.id = p.brand_id AND b.business_id = p.business_id
     WHERE ${filter}`,
    values,
  );
  const totalCount = safeInteger(countResult.rows[0]?.totalCount ?? "0", "product count");
  const result = await executor.query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS}
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
     LEFT JOIN brands b ON b.id = p.brand_id AND b.business_id = p.business_id
     JOIN units u ON u.id = p.base_unit_id
     WHERE ${filter}
     ORDER BY lower(p.name), p.id
     LIMIT $3 OFFSET $4`,
    [...values, query.limit, query.offset],
  );
  return { items: result.rows.map(mapProduct), totalCount };
}

export async function findProduct(
  executor: ProductExecutor,
  businessId: string,
  productId: string,
): Promise<ProductRecord | null> {
  const result = await executor.query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS}
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
     LEFT JOIN brands b ON b.id = p.brand_id AND b.business_id = p.business_id
     JOIN units u ON u.id = p.base_unit_id
     WHERE p.business_id = $1 AND p.id = $2`,
    [businessId, productId],
  );
  const row = result.rows[0];
  return row ? mapProduct(row) : null;
}

export async function findAvailableProductReferences(
  executor: ProductExecutor,
  businessId: string,
  input: ProductCreateInput,
): Promise<{ categoryAvailable: boolean; brandAvailable: boolean; unitAvailable: boolean }> {
  const result = await executor.query<{
    categoryAvailable: boolean;
    brandAvailable: boolean;
    unitAvailable: boolean;
  }>(
    `SELECT
       ($2::uuid IS NULL OR EXISTS (
         SELECT 1 FROM categories
         WHERE id = $2 AND business_id = $1 AND is_active = TRUE
       )) AS "categoryAvailable",
       ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM brands
         WHERE id = $3 AND business_id = $1 AND is_active = TRUE
       )) AS "brandAvailable",
       EXISTS (
         SELECT 1 FROM units
         WHERE id = $4 AND is_active = TRUE
           AND (business_id IS NULL OR business_id = $1)
       ) AS "unitAvailable"`,
    [businessId, input.categoryId ?? null, input.brandId ?? null, input.baseUnitId],
  );
  const references = result.rows[0];
  if (!references) {
    throw new Error("PostgreSQL did not return product reference validation.");
  }
  return references;
}

export async function createProduct(
  client: PoolClient,
  businessId: string,
  createdBy: string,
  input: ProductCreateInput,
): Promise<ProductRecord> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO products
       (business_id, category_id, brand_id, name, sku, barcode, description,
        size_dimensions, colour, base_unit_id, purchase_price, selling_price,
        min_stock_quantity, vat_class)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      businessId,
      input.categoryId ?? null,
      input.brandId ?? null,
      input.name,
      input.sku,
      input.barcode ?? null,
      input.description ?? null,
      input.sizeDimensions ?? null,
      input.colour ?? null,
      input.baseUnitId,
      input.purchasePrice,
      input.sellingPrice,
      input.minStockQuantity,
      input.vatClass,
    ],
  );
  const productId = result.rows[0]?.id;
  if (!productId) {
    throw new Error("PostgreSQL did not return the created product.");
  }

  await client.query(
    `INSERT INTO product_units (product_id, unit_id, conversion_factor, is_base, selling_price)
     VALUES ($1, $2, 1000, TRUE, $3)`,
    [productId, input.baseUnitId, input.sellingPrice],
  );
  await client.query(
    `INSERT INTO product_prices (product_id, price_type, unit_id, price, created_by)
     VALUES ($1, 'purchase', $2, $3, $5),
            ($1, 'selling', $2, $4, $5)`,
    [productId, input.baseUnitId, input.purchasePrice, input.sellingPrice, createdBy],
  );

  const product = await findProduct(client, businessId, productId);
  if (!product) {
    throw new Error("The created product could not be read back.");
  }
  return product;
}

export async function listProductUnits(
  executor: ProductExecutor,
  businessId: string,
  productId: string,
): Promise<ProductUnitRecord[]> {
  const result = await executor.query<ProductUnitRow>(
    `SELECT ${PRODUCT_UNIT_COLUMNS}
     FROM product_units pu
     JOIN products p ON p.id = pu.product_id
     JOIN units u ON u.id = pu.unit_id
     WHERE p.business_id = $1 AND p.id = $2
     ORDER BY pu.is_base DESC, pu.sort_order, lower(u.name), u.id`,
    [businessId, productId],
  );
  return result.rows.map(mapProductUnit);
}

export async function createProductUnit(
  client: PoolClient,
  businessId: string,
  createdBy: string,
  productId: string,
  input: ProductUnitCreateInput,
): Promise<ProductUnitRecord> {
  const productResult = await client.query<{ baseUnitId: string; baseUnitDecimalsOk: boolean }>(
    `SELECT p.base_unit_id AS "baseUnitId", base_unit.decimals_ok AS "baseUnitDecimalsOk"
     FROM products p
     JOIN units base_unit ON base_unit.id = p.base_unit_id
     WHERE p.business_id = $1 AND p.id = $2
     FOR UPDATE OF p`,
    [businessId, productId],
  );
  const product = productResult.rows[0];
  if (!product) {
    throw new ProductRuleError(404, "product_not_found", "The product is unavailable to this business.");
  }
  if (input.unitId === product.baseUnitId) {
    throw new ProductRuleError(400, "invalid_product_unit", "The base unit is already configured for this product.");
  }
  if (!product.baseUnitDecimalsOk && input.conversionFactor % 1000 !== 0) {
    throw new ProductRuleError(
      400,
      "invalid_product_unit",
      "Fractional base-unit conversions require a base unit that allows decimals.",
    );
  }

  const unitResult = await client.query(
    `SELECT id
     FROM units
     WHERE id = $1 AND is_active = TRUE
       AND (business_id IS NULL OR business_id = $2)`,
    [input.unitId, businessId],
  );
  if (unitResult.rowCount !== 1) {
    throw new ProductRuleError(
      400,
      "invalid_product_unit",
      "The selling unit must be active and available to this business.",
    );
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO product_units (product_id, unit_id, conversion_factor, selling_price)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [productId, input.unitId, input.conversionFactor, input.sellingPrice],
  );
  const productUnitId = inserted.rows[0]?.id;
  if (!productUnitId) {
    throw new Error("PostgreSQL did not return the created selling unit.");
  }
  if (input.sellingPrice !== null) {
    await client.query(
      `INSERT INTO product_prices (product_id, price_type, unit_id, price, created_by)
       VALUES ($1, 'selling', $2, $3, $4)`,
      [productId, input.unitId, input.sellingPrice, createdBy],
    );
  }

  const unit = (await listProductUnits(client, businessId, productId))
    .find((candidate) => candidate.id === productUnitId);
  if (!unit) {
    throw new Error("The created selling unit could not be read back.");
  }
  return unit;
}

export async function updateBaseSellingPrice(
  client: PoolClient,
  businessId: string,
  productId: string,
  sellingPrice: number,
  createdBy: string,
): Promise<{ product: ProductRecord; changed: boolean }> {
  const productResult = await client.query<{
    baseUnitId: string;
    purchasePrice: string;
    currentPrice: string;
    minimumSellingPrice: string;
  }>(
    `SELECT
       product.base_unit_id AS "baseUnitId",
       product.purchase_price::text AS "purchasePrice",
       product.selling_price::text AS "currentPrice",
       COALESCE(
         (
           SELECT MAX(layer.unit_cost)
           FROM inventory_cost_layers AS layer
           WHERE layer.business_id = product.business_id
             AND layer.product_id = product.id
             AND layer.quantity_remaining > 0
         ),
         product.purchase_price
       )::text AS "minimumSellingPrice"
     FROM products AS product
     WHERE product.business_id = $1 AND product.id = $2 AND product.is_active = TRUE
     FOR UPDATE OF product`,
    [businessId, productId],
  );
  const current = productResult.rows[0];
  if (!current) {
    throw new ProductRuleError(
      404,
      "product_not_found",
      "An active product belonging to this business is required.",
    );
  }
  const currentPrice = safeInteger(current.currentPrice, "selling price");
  const minimumSellingPrice = safeInteger(current.minimumSellingPrice, "minimum selling price");
  if (sellingPrice < minimumSellingPrice) {
    throw new ProductRuleError(
      400,
      "selling_price_below_cost",
      "The selling price must not be below the highest purchase cost of stock on hand.",
    );
  }

  const product = await findProduct(client, businessId, productId);
  if (!product) {
    throw new Error("The product is unavailable to this business.");
  }
  if (currentPrice === sellingPrice) {
    return { product, changed: false };
  }

  await client.query(
    `UPDATE products SET selling_price = $1, updated_at = now()
     WHERE business_id = $2 AND id = $3`,
    [sellingPrice, businessId, productId],
  );
  const updatedUnit = await client.query(
    `UPDATE product_units SET selling_price = $1, updated_at = now()
     WHERE product_id = $2 AND unit_id = $3 AND is_base = TRUE`,
    [sellingPrice, productId, current.baseUnitId],
  );
  if (updatedUnit.rowCount !== 1) {
    throw new Error("The product's base selling unit is missing.");
  }
  await client.query(
    `UPDATE product_prices SET effective_to = now()
     WHERE product_id = $1 AND unit_id = $2
       AND price_type = 'selling' AND effective_to IS NULL`,
    [productId, current.baseUnitId],
  );
  await client.query(
    `INSERT INTO product_prices (product_id, price_type, unit_id, price, created_by)
     VALUES ($1, 'selling', $2, $3, $4)`,
    [productId, current.baseUnitId, sellingPrice, createdBy],
  );

  const updatedProduct = await findProduct(client, businessId, productId);
  if (!updatedProduct) {
    throw new Error("The updated product could not be read back.");
  }
  return { product: updatedProduct, changed: true };
}
