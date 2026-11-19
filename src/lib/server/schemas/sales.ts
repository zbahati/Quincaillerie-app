import { z } from "zod";

const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export const salesHistoryQuerySchema = z.object({
  branchId: uuidSchema,
  search: z.string().trim().max(200).optional(),
  fromDate: dateSchema,
  toDate: dateSchema,
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
}).superRefine((value, context) => {
  if (value.fromDate && value.toDate && value.fromDate > value.toDate) {
    context.addIssue({
      code: "custom",
      path: ["fromDate"],
      message: "The start date cannot be after the end date.",
    });
  }
});

export type SalesHistoryQuery = z.infer<typeof salesHistoryQuerySchema>;
