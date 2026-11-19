import { z } from "zod";

const uuidSchema = z.string().uuid();
const safeNonNegativeInteger = z.number()
  .int()
  .min(0)
  .refine(Number.isSafeInteger, "The value is too large.");

function nullableText(maximum: number) {
  return z.string().trim().max(maximum).nullable().optional().transform((value) => value || null);
}

export const inventoryBranchIdSchema = uuidSchema;

export const inventoryListQuerySchema = z.object({
  branchId: uuidSchema.optional(),
  search: z.string().max(200).optional(),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const stockMovementListQuerySchema = z.object({
  branchId: uuidSchema.optional(),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const openingStockSchema = z.object({
  branchId: uuidSchema.optional(),
  quantity: safeNonNegativeInteger,
  reason: nullableText(500),
});

export const stockCorrectionSchema = z.object({
  branchId: uuidSchema.optional(),
  targetQuantity: safeNonNegativeInteger,
  reason: z.string().trim().min(1).max(500),
});

export const stockReceiptSchema = z.object({
  branchId: uuidSchema.optional(),
  quantity: safeNonNegativeInteger.min(1),
  receivedUnitCost: safeNonNegativeInteger,
  receiptReference: z.string().trim().min(1).max(200),
  reason: nullableText(500),
  newSellingPrice: safeNonNegativeInteger.nullable().optional(),
});

export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
export type StockMovementListQuery = z.infer<typeof stockMovementListQuerySchema>;
export type OpeningStockInput = z.infer<typeof openingStockSchema>;
export type StockCorrectionInput = z.infer<typeof stockCorrectionSchema>;
export type StockReceiptInput = z.infer<typeof stockReceiptSchema>;
