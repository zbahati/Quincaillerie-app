import { z } from "zod";

const uuidSchema = z.string().uuid();

export const customerIdSchema = uuidSchema;
export const customerDebtIdSchema = uuidSchema;
export const customerDebtBranchIdSchema = uuidSchema;

export const customerDebtPaymentSchema = z.object({
  branchId: z.string().uuid(),
  paymentMethod: z.enum(["cash", "mtn_mobile_money", "airtel_money", "bank_transfer"]),
  amount: z.number().int().min(1).refine(Number.isSafeInteger),
});

export type CustomerDebtPaymentInput = z.infer<typeof customerDebtPaymentSchema>;
