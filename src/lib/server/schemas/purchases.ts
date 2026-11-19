import { z } from "zod";

const uuidSchema = z.string().uuid();
const safeNonNegativeInteger = z.number().int().min(0).refine(Number.isSafeInteger);

export const purchaseIdSchema = uuidSchema;
export const purchaseBranchIdSchema = uuidSchema;

export const purchaseCreateSchema = z.object({
  branchId: uuidSchema,
  supplierId: uuidSchema,
  supplierInvoiceNumber: z.string().trim().min(1).max(200),
  authorizeDuplicate: z.boolean(),
  items: z.array(z.object({
    productId: uuidSchema,
    orderedQuantity: z.number().int().min(1).refine(Number.isSafeInteger),
    unitCost: safeNonNegativeInteger,
  })).min(1).max(100),
});

export const purchaseReceiptSchema = z.object({
  branchId: uuidSchema,
  deliveryReference: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  items: z.array(z.object({
    purchaseItemId: uuidSchema,
    quantity: z.number().int().min(1).refine(Number.isSafeInteger),
  })).min(1).max(100),
});

export const purchasePaymentSchema = z.object({
  branchId: uuidSchema,
  amount: z.number().int().min(1).refine(Number.isSafeInteger),
  paymentMethod: z.enum(["cash", "mtn_mobile_money", "airtel_money", "bank_transfer"]),
  cashAccountId: uuidSchema,
});

export const purchaseListQuerySchema = z.object({
  branchId: uuidSchema.optional(),
});

export const purchaseHistoryQuerySchema = z.object({
  branchId: uuidSchema,
  search: z.string().trim().max(200).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  offset: z.coerce.number().int().min(0).refine(Number.isSafeInteger).default(0),
  limit: z.coerce.number().int().min(1).max(100).refine(Number.isSafeInteger).default(30),
}).superRefine((query, context) => {
  for (const date of [query.fromDate, query.toDate]) {
    if (date) {
      const parsed = new Date(`${date}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        context.addIssue({ code: "custom", message: "Enter a valid purchase date." });
      }
    }
  }
  if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
    context.addIssue({ code: "custom", message: "Purchase start date cannot be after its end date." });
  }
});

export type PurchaseCreateInput = z.infer<typeof purchaseCreateSchema>;
export type PurchaseReceiptInput = z.infer<typeof purchaseReceiptSchema>;
export type PurchasePaymentInput = z.infer<typeof purchasePaymentSchema>;
export type PurchaseListQuery = z.infer<typeof purchaseListQuerySchema>;
export type PurchaseHistoryQuery = z.infer<typeof purchaseHistoryQuerySchema>;
