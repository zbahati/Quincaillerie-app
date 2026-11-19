import { z } from "zod";

export const businessSettingsUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  taxId: z.string().trim().max(80).nullable(),
});

export type BusinessSettingsUpdateInput = z.infer<typeof businessSettingsUpdateSchema>;
