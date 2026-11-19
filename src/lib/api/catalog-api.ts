import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface BusinessCategory {
  id: string;
  business_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface BusinessBrand {
  id: string;
  business_id: string;
  name: string;
  is_active: boolean;
}

export interface BusinessUnit {
  id: string;
  business_id: string | null;
  code: string;
  name: string;
  decimals_ok: boolean;
  is_system: boolean;
  is_active: boolean;
}

function parseCategory(value: unknown): BusinessCategory {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.business_id !== "string" ||
    (value.parent_id !== null && typeof value.parent_id !== "string") ||
    typeof value.name !== "string" ||
    (value.description !== null && typeof value.description !== "string") ||
    typeof value.is_active !== "boolean"
  ) {
    throw invalidResponse("The service returned invalid category information.");
  }
  return {
    id: value.id,
    business_id: value.business_id,
    parent_id: value.parent_id,
    name: value.name,
    description: value.description,
    is_active: value.is_active,
  };
}

function parseBrand(value: unknown): BusinessBrand {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.business_id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.is_active !== "boolean"
  ) {
    throw invalidResponse("The service returned invalid brand information.");
  }
  return {
    id: value.id,
    business_id: value.business_id,
    name: value.name,
    is_active: value.is_active,
  };
}

function parseUnit(value: unknown): BusinessUnit {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    (value.business_id !== null && typeof value.business_id !== "string") ||
    typeof value.code !== "string" ||
    typeof value.name !== "string" ||
    typeof value.decimals_ok !== "boolean" ||
    typeof value.is_system !== "boolean" ||
    typeof value.is_active !== "boolean"
  ) {
    throw invalidResponse("The service returned invalid unit information.");
  }
  return {
    id: value.id,
    business_id: value.business_id,
    code: value.code,
    name: value.name,
    decimals_ok: value.decimals_ok,
    is_system: value.is_system,
    is_active: value.is_active,
  };
}

function parseList<T>(
  value: unknown,
  key: string,
  parser: (input: unknown) => T,
): T[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    throw invalidResponse("The service returned invalid catalog information.");
  }
  return value[key].map(parser);
}

function parseSingle<T>(
  value: unknown,
  key: string,
  parser: (input: unknown) => T,
): T {
  if (!isRecord(value) || !(key in value)) {
    throw invalidResponse("The service returned invalid catalog information.");
  }
  return parser(value[key]);
}

function postJson(path: string, body: unknown) {
  return requestJson(path, { method: "POST", body: JSON.stringify(body) });
}

export const catalogApi = {
  async categories(): Promise<BusinessCategory[]> {
    return parseList(await requestJson("/api/catalog/categories"), "categories", parseCategory);
  },

  async createCategory(input: {
    parentId: string | null;
    name: string;
    description: string | null;
  }): Promise<BusinessCategory> {
    return parseSingle(
      await postJson("/api/catalog/categories", input),
      "category",
      parseCategory,
    );
  },

  async brands(): Promise<BusinessBrand[]> {
    return parseList(await requestJson("/api/catalog/brands"), "brands", parseBrand);
  },

  async createBrand(input: { name: string }): Promise<BusinessBrand> {
    return parseSingle(await postJson("/api/catalog/brands", input), "brand", parseBrand);
  },

  async units(): Promise<BusinessUnit[]> {
    return parseList(await requestJson("/api/catalog/units"), "units", parseUnit);
  },

  async createUnit(input: {
    code: string;
    name: string;
    decimalsOk: boolean;
  }): Promise<BusinessUnit> {
    return parseSingle(await postJson("/api/catalog/units", input), "unit", parseUnit);
  },
};
