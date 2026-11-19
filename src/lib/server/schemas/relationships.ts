import { z } from "zod";

const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional().transform((value) => value || null);

const nullableEmail = z
  .union([z.literal(""), z.string().trim().max(254).email(), z.null()])
  .optional()
  .transform((value) => value || null);

const recordIdSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(160);
const safeNonNegativeInteger = z.number()
  .int()
  .min(0)
  .refine(Number.isSafeInteger, "The value is too large.");

export const supplierIdSchema = recordIdSchema;
export const customerIdSchema = recordIdSchema;

export const supplierCreateSchema = z.object({
  name: nameSchema,
  contactPerson: nullableText(160),
  phone: nullableText(80),
  email: nullableEmail,
  address: nullableText(500),
  taxId: nullableText(100),
});

export const supplierUpdateSchema = supplierCreateSchema.extend({
  isActive: z.boolean(),
});

export const customerCreateSchema = z.object({
  name: nameSchema,
  phone: nullableText(80),
  address: nullableText(500),
  customerType: z.enum(["individual", "business"]),
  creditLimit: safeNonNegativeInteger,
});

export const customerUpdateSchema = customerCreateSchema.extend({
  isActive: z.boolean(),
});

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
