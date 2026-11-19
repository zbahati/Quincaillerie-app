import { z } from "zod";

const uuidSchema = z.string().uuid();

export const cashAccountCreateSchema = z.object({
  branchId: uuidSchema.nullable().optional(),
  accountType: z.enum(["cash_drawer", "bank", "mtn_wallet", "airtel_wallet", "other"]),
  name: z.string().trim().min(1).max(120),
});

export const cashAccountOpeningSchema = z.object({
  openingAmount: z.number().int().min(0).refine(Number.isSafeInteger),
});

export const cashAccountUpdateSchema = z.object({
  isActive: z.boolean(),
});

export const cashTransferCreateSchema = z.object({
  fromAccountId: uuidSchema,
  toAccountId: uuidSchema,
  amount: z.number().int().min(1).refine(Number.isSafeInteger),
});

export const cashTransferConfirmSchema = z.object({
  confirmationReference: z.string().trim().max(200).nullable().optional(),
});

export const expenseCreateSchema = z.object({
  branchId: uuidSchema.nullable().optional(),
  category: z.enum(["rent", "electricity", "transport", "salaries", "internet", "repairs", "security", "other"]),
  amount: z.number().int().min(1).refine(Number.isSafeInteger),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.enum(["cash", "mtn_mobile_money", "airtel_money", "bank_transfer"]),
  cashAccountId: uuidSchema,
  description: z.string().trim().min(1).max(1000),
  responsibleName: z.string().trim().min(1).max(120),
});

export type CashAccountCreateInput = z.infer<typeof cashAccountCreateSchema>;
export type CashAccountOpeningInput = z.infer<typeof cashAccountOpeningSchema>;
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
