import { z } from "zod";

export const reportRangeQuerySchema = z.object({
  branchId: z.string().uuid(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).superRefine((value, context) => {
  if (value.fromDate > value.toDate) {
    context.addIssue({
      code: "custom",
      path: ["fromDate"],
      message: "The start date cannot be after the end date.",
    });
  }
});

export type ReportRangeQuery = z.infer<typeof reportRangeQuerySchema>;

export const balanceSheetQuerySchema = z.object({
  branchId: z.string().uuid(),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
