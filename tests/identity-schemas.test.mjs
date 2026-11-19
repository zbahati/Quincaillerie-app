import assert from "node:assert/strict";
import test from "node:test";

import {
  adminBootstrapSchema,
  managerCreateSchema,
  managerPermissionUpdateSchema,
  signInSchema,
} from "../src/lib/server/schemas/identity.ts";

const businessId = "75bb5720-bc9f-45a6-8884-2e5df17930f7";

function bootstrapInput(overrides = {}) {
  return {
    businessId: null,
    businessName: "  Quincaillerie Kivu ",
    username: "  ADMIN.User ",
    fullName: "  Aline Example ",
    email: "  ALINE@example.com ",
    password: "A-long-enough-password",
    ...overrides,
  };
}

test("normalizes the initial Admin identity while preserving password contents", () => {
  const parsed = adminBootstrapSchema.parse(bootstrapInput());

  assert.equal(parsed.businessName, "Quincaillerie Kivu");
  assert.equal(parsed.username, "admin.user");
  assert.equal(parsed.fullName, "Aline Example");
  assert.equal(parsed.email, "aline@example.com");
  assert.equal(parsed.password, "A-long-enough-password");
});

test("requires a business name only when bootstrapping a new business", () => {
  assert.equal(
    adminBootstrapSchema.safeParse(bootstrapInput({ businessName: null })).success,
    false,
  );
  assert.equal(
    adminBootstrapSchema.safeParse(
      bootstrapInput({ businessId, businessName: "Unexpected new business" }),
    ).success,
    false,
  );
  assert.equal(
    adminBootstrapSchema.safeParse(
      bootstrapInput({ businessId, businessName: null }),
    ).success,
    true,
  );
});

test("matches the desktop's 12–128 Unicode-character password limits", () => {
  const validPassword = "😀".repeat(12);
  assert.equal(
    adminBootstrapSchema.safeParse(bootstrapInput({ password: validPassword })).success,
    true,
  );
  assert.equal(
    adminBootstrapSchema.safeParse(bootstrapInput({ password: "😀".repeat(129) })).success,
    false,
  );
  assert.equal(
    signInSchema.safeParse({ businessId, username: "manager", password: "😀".repeat(129) }).success,
    false,
  );
});

test("requires a Manager to have exactly one valid branch assignment", () => {
  const input = {
    branchId: "e35d7552-56ca-481f-8fd5-d401d9e096c9",
    username: "manager.one",
    fullName: "Manager One",
    password: "A-long-enough-password",
  };
  assert.equal(managerCreateSchema.safeParse(input).success, true);
  assert.equal(managerCreateSchema.safeParse({ ...input, branchId: null }).success, false);
});

test("requires the complete Manager permission set exactly once", () => {
  const grants = [
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
  ].map((permissionId) => ({ permissionId, enabled: true }));

  assert.equal(managerPermissionUpdateSchema.safeParse(grants).success, true);
  assert.equal(
    managerPermissionUpdateSchema.safeParse([...grants.slice(1), grants[0]]).success,
    true,
  );
  assert.equal(
    managerPermissionUpdateSchema.safeParse([...grants.slice(1), grants[0], grants[0]]).success,
    false,
  );
  assert.equal(
    managerPermissionUpdateSchema.safeParse([
      ...grants.slice(1),
      { permissionId: "reports.read", enabled: true },
    ]).success,
    false,
  );
});
