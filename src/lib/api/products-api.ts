import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface Product {
  id: string;
  business_id: string;
  category_id: string | null;
  category_name: string | null;
  brand_id: string | null;
  brand_name: string | null;
  name: string;
  sku: string;
  barcode: string | null;
  description: string | null;
  size_dimensions: string | null;
  colour: string | null;
  base_unit_id: string;
  base_unit_name: string;
  base_unit_code: string;
  purchase_price: number;
  selling_price: number;
  min_stock_quantity: number;
  vat_class: string;
  is_active: boolean;
}

export interface ProductPage {
  items: Product[];
  total_count: number;
}

export interface ProductUnit {
  id: string;
  product_id: string;
  unit_id: string;
  unit_name: string;
  unit_code: string;
  conversion_factor: number;
  is_base: boolean;
  selling_price: number | null;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseProduct(value: unknown): Product {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.business_id !== "string" ||
    !nullableString(value.category_id) ||
    !nullableString(value.category_name) ||
    !nullableString(value.brand_id) ||
    !nullableString(value.brand_name) ||
    typeof value.name !== "string" ||
    typeof value.sku !== "string" ||
    !nullableString(value.barcode) ||
    !nullableString(value.description) ||
    !nullableString(value.size_dimensions) ||
    !nullableString(value.colour) ||
    typeof value.base_unit_id !== "string" ||
    typeof value.base_unit_name !== "string" ||
    typeof value.base_unit_code !== "string" ||
    !isSafeNonNegativeInteger(value.purchase_price) ||
    !isSafeNonNegativeInteger(value.selling_price) ||
    !isSafeNonNegativeInteger(value.min_stock_quantity) ||
    typeof value.vat_class !== "string" ||
    typeof value.is_active !== "boolean"
  ) {
    throw invalidResponse("The service returned invalid product information.");
  }
  return {
    id: value.id,
    business_id: value.business_id,
    category_id: value.category_id,
    category_name: value.category_name,
    brand_id: value.brand_id,
    brand_name: value.brand_name,
    name: value.name,
    sku: value.sku,
    barcode: value.barcode,
    description: value.description,
    size_dimensions: value.size_dimensions,
    colour: value.colour,
    base_unit_id: value.base_unit_id,
    base_unit_name: value.base_unit_name,
    base_unit_code: value.base_unit_code,
    purchase_price: value.purchase_price,
    selling_price: value.selling_price,
    min_stock_quantity: value.min_stock_quantity,
    vat_class: value.vat_class,
    is_active: value.is_active,
  };
}

function parseProductUnit(value: unknown): ProductUnit {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.product_id !== "string" ||
    typeof value.unit_id !== "string" ||
    typeof value.unit_name !== "string" ||
    typeof value.unit_code !== "string" ||
    !isSafeNonNegativeInteger(value.conversion_factor) ||
    typeof value.is_base !== "boolean" ||
    (value.selling_price !== null && !isSafeNonNegativeInteger(value.selling_price))
  ) {
    throw invalidResponse("The service returned invalid product selling-unit information.");
  }
  return {
    id: value.id,
    product_id: value.product_id,
    unit_id: value.unit_id,
    unit_name: value.unit_name,
    unit_code: value.unit_code,
    conversion_factor: value.conversion_factor,
    is_base: value.is_base,
    selling_price: value.selling_price,
  };
}

function parseProductList(value: unknown): ProductPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !isSafeNonNegativeInteger(value.total_count)
  ) {
    throw invalidResponse("The service returned an invalid product catalogue.");
  }
  return { items: value.items.map(parseProduct), total_count: value.total_count };
}

function parseProductUnits(value: unknown): ProductUnit[] {
  if (!isRecord(value) || !Array.isArray(value.units)) {
    throw invalidResponse("The service returned invalid product selling units.");
  }
  return value.units.map(parseProductUnit);
}

function parseProductResponse(value: unknown): Product {
  if (!isRecord(value) || !("product" in value)) {
    throw invalidResponse("The service returned an invalid product response.");
  }
  return parseProduct(value.product);
}

function parseUnitResponse(value: unknown): ProductUnit {
  if (!isRecord(value) || !("unit" in value)) {
    throw invalidResponse("The service returned an invalid product unit response.");
  }
  return parseProductUnit(value.unit);
}

export const productsApi = {
  async list(input: { search: string; offset: number; limit: number }): Promise<ProductPage> {
    const parameters = new URLSearchParams({
      offset: String(input.offset),
      limit: String(input.limit),
    });
    if (input.search) {
      parameters.set("search", input.search);
    }
    return parseProductList(await requestJson(`/api/products?${parameters.toString()}`));
  },

  async create(input: {
    categoryId: string | null;
    brandId: string | null;
    name: string;
    sku: string;
    barcode: string | null;
    description: string | null;
    sizeDimensions: string | null;
    colour: string | null;
    baseUnitId: string;
    purchasePrice: number;
    sellingPrice: number;
    minStockQuantity: number;
    vatClass: string;
  }): Promise<Product> {
    return parseProductResponse(
      await requestJson("/api/products", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  },

  async units(productId: string): Promise<ProductUnit[]> {
    return parseProductUnits(await requestJson(`/api/products/${productId}/units`));
  },

  async createUnit(
    productId: string,
    input: { unitId: string; conversionFactor: number; sellingPrice: number | null },
  ): Promise<ProductUnit> {
    return parseUnitResponse(
      await requestJson(`/api/products/${productId}/units`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  },

  async updateSellingPrice(productId: string, sellingPrice: number): Promise<Product> {
    return parseProductResponse(
      await requestJson(`/api/products/${productId}/selling-price`, {
        method: "PATCH",
        body: JSON.stringify({ sellingPrice }),
      }),
    );
  },
};
