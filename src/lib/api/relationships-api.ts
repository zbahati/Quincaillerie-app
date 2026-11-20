import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface Supplier {
  id: string;
  business_id: string;
  branch_id: string | null;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_id: string | null;
  is_active: boolean;
}

export interface Customer {
  id: string;
  business_id: string;
  branch_id: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  customer_type: "individual" | "business";
  credit_limit: number;
  is_active: boolean;
}

export interface SupplierInput {
  branchId: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
}

export interface CustomerInput {
  branchId: string;
  name: string;
  phone: string | null;
  address: string | null;
  customerType: "individual" | "business";
  creditLimit: number;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseSupplier(value: unknown): Supplier {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.business_id !== "string" ||
    (value.branch_id !== null && typeof value.branch_id !== "string") ||
    typeof value.name !== "string" ||
    !isNullableString(value.contact_person) ||
    !isNullableString(value.phone) ||
    !isNullableString(value.email) ||
    !isNullableString(value.address) ||
    !isNullableString(value.tax_id) ||
    typeof value.is_active !== "boolean"
  ) {
    throw invalidResponse("The service returned invalid supplier information.");
  }
  return {
    id: value.id,
    business_id: value.business_id,
    branch_id: value.branch_id,
    name: value.name,
    contact_person: value.contact_person,
    phone: value.phone,
    email: value.email,
    address: value.address,
    tax_id: value.tax_id,
    is_active: value.is_active,
  };
}

function parseCustomer(value: unknown): Customer {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.business_id !== "string" ||
    (value.branch_id !== null && typeof value.branch_id !== "string") ||
    typeof value.name !== "string" ||
    !isNullableString(value.phone) ||
    !isNullableString(value.address) ||
    (value.customer_type !== "individual" && value.customer_type !== "business") ||
    !isSafeNonNegativeInteger(value.credit_limit) ||
    typeof value.is_active !== "boolean"
  ) {
    throw invalidResponse("The service returned invalid customer information.");
  }
  return {
    id: value.id,
    business_id: value.business_id,
    branch_id: value.branch_id,
    name: value.name,
    phone: value.phone,
    address: value.address,
    customer_type: value.customer_type,
    credit_limit: value.credit_limit,
    is_active: value.is_active,
  };
}

function parseList<T>(
  value: unknown,
  key: "suppliers" | "customers",
  parseItem: (item: unknown) => T,
): T[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    throw invalidResponse(`The service returned invalid ${key}.`);
  }
  return value[key].map(parseItem);
}

function parseRecord<T>(
  value: unknown,
  key: "supplier" | "customer",
  parseItem: (item: unknown) => T,
): T {
  if (!isRecord(value) || !(key in value)) {
    throw invalidResponse(`The service returned an invalid ${key} response.`);
  }
  return parseItem(value[key]);
}

export const suppliersApi = {
  async list(branchId: string | null): Promise<Supplier[]> {
    const scope = branchId ?? "unassigned";
    return parseList(
      await requestJson(`/api/suppliers?branchId=${encodeURIComponent(scope)}`),
      "suppliers",
      parseSupplier,
    );
  },

  async create(input: SupplierInput): Promise<Supplier> {
    return parseRecord(
      await requestJson("/api/suppliers", {
        method: "POST",
        body: JSON.stringify(input),
      }),
      "supplier",
      parseSupplier,
    );
  },

  async update(supplierId: string, input: SupplierInput & { isActive: boolean }): Promise<Supplier> {
    return parseRecord(
      await requestJson(`/api/suppliers/${encodeURIComponent(supplierId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
      "supplier",
      parseSupplier,
    );
  },
};

export const customersApi = {
  async list(branchId: string | null): Promise<Customer[]> {
    const scope = branchId ?? "unassigned";
    return parseList(
      await requestJson(`/api/customers?branchId=${encodeURIComponent(scope)}`),
      "customers",
      parseCustomer,
    );
  },

  async create(input: CustomerInput): Promise<Customer> {
    return parseRecord(
      await requestJson("/api/customers", {
        method: "POST",
        body: JSON.stringify(input),
      }),
      "customer",
      parseCustomer,
    );
  },

  async update(customerId: string, input: CustomerInput & { isActive: boolean }): Promise<Customer> {
    return parseRecord(
      await requestJson(`/api/customers/${encodeURIComponent(customerId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
      "customer",
      parseCustomer,
    );
  },
};
