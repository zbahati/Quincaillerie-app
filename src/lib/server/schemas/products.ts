import { z } from "zod";

const uuidSchema = z.string().uuid();
export const productIdSchema = uuidSchema;
const safeNonNegativeInteger = z.number()
  .int()
  .min(0)
  .refine(Number.isSafeInteger, "The value is too large.");

function nullableText(maximum: number) {
  return z.string().trim().max(maximum).nullable().optional().transform((value) => value || null);
}

export const productListQuerySchema = z.object({
  search: z.string().max(200).optional(),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const productCreateSchema = z.object({
  categoryId: uuidSchema.nullable().optional(),
  brandId: uuidSchema.nullable().optional(),
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().min(1).max(80).transform((value) =>
    value.replace(/[a-z]/g, (character) => character.toUpperCase()),
  ),
  barcode: nullableText(120),
  description: nullableText(500),
  sizeDimensions: nullableText(120),
  colour: nullableText(80),
  baseUnitId: uuidSchema,
  purchasePrice: safeNonNegativeInteger,
  sellingPrice: safeNonNegativeInteger,
  minStockQuantity: safeNonNegativeInteger,
  vatClass: z.enum(["standard", "zero", "exempt"]),
});

export const productUnitCreateSchema = z.object({
  unitId: uuidSchema,
  conversionFactor: z.number()
    .int()
    .min(1)
    .refine(Number.isSafeInteger, "The conversion factor is too large."),
  sellingPrice: safeNonNegativeInteger.nullable(),
});

export const productSellingPriceUpdateSchema = z.object({
  sellingPrice: safeNonNegativeInteger,
});

export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUnitCreateInput = z.infer<typeof productUnitCreateSchema>;
export type ProductSellingPriceUpdateInput = z.infer<typeof productSellingPriceUpdateSchema>;
export type ProductId = z.infer<typeof uuidSchema>;
