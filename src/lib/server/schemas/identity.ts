import { z } from "zod";

const uuidSchema = z.string().uuid();

function characterCount(value: string): number {
  return [...value].length;
}

function passwordSchema(minimumLength: number) {
  return z.string().superRefine((value, context) => {
    const length = characterCount(value);
    if (length < minimumLength) {
      context.addIssue({
        code: "custom",
        message: `Password must contain at least ${minimumLength} characters.`,
      });
    }
    if (length > 128) {
      context.addIssue({
        code: "custom",
        message: "Password must contain no more than 128 characters.",
      });
    }
  });
}

const signInPasswordSchema = z.string().superRefine((value, context) => {
  if (characterCount(value) === 0) {
    context.addIssue({ code: "custom", message: "Password is required." });
  } else if (characterCount(value) > 128) {
    context.addIssue({
      code: "custom",
      message: "Password must contain no more than 128 characters.",
    });
  }
});

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, {
    message: "Username must be 3–32 characters using letters, numbers, dots, underscores or hyphens.",
  });

export const fullNameSchema = z.string().trim().superRefine((value, context) => {
  const length = characterCount(value);
  if (length === 0 || length > 120) {
    context.addIssue({
      code: "custom",
      message: "Full name is required and must be 120 characters or fewer.",
    });
  }
});

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email();

export const businessNameSchema = z.string().trim().min(1).max(120);

export const businessDetailsSchema = z.object({
  name: businessNameSchema,
  taxId: z.string().trim().max(80).nullable(),
});

export const adminBootstrapSchema = z
  .object({
    businessId: uuidSchema.nullable(),
    businessName: businessNameSchema.nullable(),
    username: usernameSchema,
    fullName: fullNameSchema,
    email: emailSchema,
    password: passwordSchema(12),
  })
  .superRefine((value, context) => {
    if (value.businessId === null && value.businessName === null) {
      context.addIssue({
        code: "custom",
        path: ["businessName"],
        message: "A business name is required when creating the first business.",
      });
    }
    if (value.businessId !== null && value.businessName !== null) {
      context.addIssue({
        code: "custom",
        path: ["businessName"],
        message: "A business name must not be sent when setting up an existing business.",
      });
    }
  });

export const signInSchema = z.object({
  businessId: uuidSchema,
  username: usernameSchema,
  password: signInPasswordSchema,
});

export const adminPasswordResetRequestSchema = z.object({
  businessId: uuidSchema,
  email: emailSchema,
});

export const adminPasswordResetCompletionSchema = z.object({
  token: z.string().min(32).max(256),
  newPassword: passwordSchema(12),
});

export const adminEmailVerificationSchema = z.object({
  token: z.string().min(32).max(256),
});

export const adminEmailVerificationRequestSchema = z.object({
  businessId: uuidSchema,
  email: emailSchema,
});

export const branchDetailsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(240).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
});

export const branchUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    address: z.string().trim().max(240).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one branch field must be provided.",
});

export const managerCreateSchema = z.object({
  branchId: uuidSchema,
  username: usernameSchema,
  fullName: fullNameSchema,
  password: passwordSchema(12),
});

export const managerUpdateSchema = z
  .object({
    branchId: uuidSchema.optional(),
    isActive: z.boolean().optional(),
    fullName: fullNameSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "A branch or active-state update is required.",
  });

export const managerPasswordResetSchema = z.object({
  password: passwordSchema(12),
});

export const MANAGER_PERMISSION_IDS = [
  "system.read",
  "business.read",
  "cash_accounts.balance.read",
  "catalog.read",
  "catalog.manage",
  "inventory.read",
  "inventory.manage",
  "suppliers.read",
  "suppliers.manage",
  "customers.read",
  "customers.manage",
  "customer_debts.read",
  "customer_payments.manage",
  "pos.use",
  "sales.read",
  "sales.manage",
  "purchases.read",
  "purchases.manage",
  "expenses.read",
  "expenses.manage",
] as const;

const managerPermissionIdSchema = z.enum(MANAGER_PERMISSION_IDS);

export const managerPermissionUpdateSchema = z
  .array(
    z.object({
      permissionId: managerPermissionIdSchema,
      enabled: z.boolean(),
    }),
  )
  .length(MANAGER_PERMISSION_IDS.length)
  .superRefine((grants, context) => {
    const ids = new Set(grants.map((grant) => grant.permissionId));
    if (ids.size !== grants.length) {
      context.addIssue({
        code: "custom",
        message: "Each Manager permission must be provided exactly once.",
      });
    }
  });

export type AdminBootstrapInput = z.infer<typeof adminBootstrapSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type AdminPasswordResetRequestInput = z.infer<typeof adminPasswordResetRequestSchema>;
export type AdminPasswordResetCompletionInput = z.infer<typeof adminPasswordResetCompletionSchema>;
export type BusinessDetailsInput = z.infer<typeof businessDetailsSchema>;
export type BranchDetailsInput = z.infer<typeof branchDetailsSchema>;
export type BranchUpdateInput = z.infer<typeof branchUpdateSchema>;
export type ManagerCreateInput = z.infer<typeof managerCreateSchema>;
export type ManagerUpdateInput = z.infer<typeof managerUpdateSchema>;
export type ManagerPasswordResetInput = z.infer<typeof managerPasswordResetSchema>;
export type ManagerPermissionUpdate = z.infer<typeof managerPermissionUpdateSchema>;
