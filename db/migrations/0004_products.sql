-- Product catalogue and per-product selling units.
-- Money uses hundredths of RWF; quantities and conversion factors use thousandths.

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  category_id UUID,
  brand_id UUID,
  name TEXT NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 160),
  sku TEXT NOT NULL CHECK (btrim(sku) <> '' AND char_length(sku) <= 80),
  barcode TEXT CHECK (barcode IS NULL OR char_length(barcode) <= 120),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  size_dimensions TEXT CHECK (size_dimensions IS NULL OR char_length(size_dimensions) <= 120),
  colour TEXT CHECK (colour IS NULL OR char_length(colour) <= 80),
  image_path TEXT,
  base_unit_id UUID NOT NULL REFERENCES units (id),
  purchase_price BIGINT NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  selling_price BIGINT NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  min_stock_quantity BIGINT NOT NULL DEFAULT 0 CHECK (min_stock_quantity >= 0),
  vat_class TEXT NOT NULL DEFAULT 'standard'
    CHECK (vat_class IN ('standard', 'zero', 'exempt')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  CONSTRAINT products_category_same_business_fk
    FOREIGN KEY (business_id, category_id) REFERENCES categories (business_id, id),
  CONSTRAINT products_brand_same_business_fk
    FOREIGN KEY (business_id, brand_id) REFERENCES brands (business_id, id)
);

CREATE UNIQUE INDEX products_business_sku_idx
  ON products (business_id, upper(sku));
CREATE INDEX products_business_name_idx
  ON products (business_id, lower(name), id);
CREATE INDEX products_business_barcode_idx
  ON products (business_id, barcode);
CREATE INDEX products_business_category_idx
  ON products (business_id, category_id);
CREATE INDEX products_business_brand_idx
  ON products (business_id, brand_id);
CREATE INDEX products_business_active_idx
  ON products (business_id, is_active);

CREATE TABLE product_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units (id),
  conversion_factor BIGINT NOT NULL CHECK (conversion_factor > 0),
  is_base BOOLEAN NOT NULL DEFAULT FALSE,
  selling_price BIGINT CHECK (selling_price IS NULL OR selling_price >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, unit_id)
);

CREATE UNIQUE INDEX product_units_one_base_idx
  ON product_units (product_id) WHERE is_base = TRUE;
CREATE INDEX product_units_product_order_idx
  ON product_units (product_id, is_base DESC, sort_order);

CREATE TABLE product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  price_type TEXT NOT NULL CHECK (price_type IN ('purchase', 'selling')),
  unit_id UUID REFERENCES units (id),
  price BIGINT NOT NULL CHECK (price >= 0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX product_prices_product_created_idx
  ON product_prices (product_id, created_at DESC);
CREATE UNIQUE INDEX product_prices_current_unit_type_idx
  ON product_prices (product_id, unit_id, price_type)
  WHERE effective_to IS NULL AND unit_id IS NOT NULL;
