import { z } from "zod";

const uuidSchema = z.string().uuid();

export const categoryCreateSchema = z.object({
  parentId: uuidSchema.nullable().optional(),
  name: z.string().trim().min(1).max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((value) => value || null),
});

export const brandCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const unitCreateSchema = z.object({
  code: z.string().trim().toLowerCase().min(1).max(20),
  name: z.string().trim().min(1).max(80),
  decimalsOk: z.boolean(),
});

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type BrandCreateInput = z.infer<typeof brandCreateSchema>;
export type UnitCreateInput = z.infer<typeof unitCreateSchema>;
