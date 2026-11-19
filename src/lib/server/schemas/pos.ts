import { z } from "zod";

const uuidSchema = z.string().uuid();
const safeNonNegativeInteger = z.number().int().min(0).refine(Number.isSafeInteger);
const paymentMethodSchema = z.enum(["cash", "mtn_mobile_money", "airtel_money", "bank_transfer"]);

export const posListQuerySchema = z.object({
  branchId: uuidSchema,
  search: z.string().max(200).optional(),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const posPaymentOptionsQuerySchema = z.object({
  branchId: uuidSchema,
});

export const posCheckoutSchema = z.object({
  branchId: uuidSchema,
  customerId: uuidSchema.nullable().optional(),
  items: z.array(z.object({
    productId: uuidSchema,
    quantity: z.number().int().min(1).refine(Number.isSafeInteger),
    sellingPrice: safeNonNegativeInteger.nullable().optional(),
    priceChangeReason: z.string().trim().max(500).nullable().optional(),
  })).min(1).max(100),
  payments: z.array(z.object({
    paymentMethod: paymentMethodSchema,
    amount: z.number().int().min(1).refine(Number.isSafeInteger),
    cashAccountId: uuidSchema,
  })).min(1).max(10),
});

export type PosListQuery = z.infer<typeof posListQuerySchema>;
export type PosCheckoutInput = z.infer<typeof posCheckoutSchema>;
export type PosPaymentOptionsQuery = z.infer<typeof posPaymentOptionsQuerySchema>;
