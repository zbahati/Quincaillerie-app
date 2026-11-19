-- Business settings catalog used by the copied Settings screen.

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  parent_id UUID,
  name TEXT NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  CONSTRAINT categories_parent_same_business_fk
    FOREIGN KEY (business_id, parent_id) REFERENCES categories (business_id, id)
);

CREATE UNIQUE INDEX categories_unique_name_idx
  ON categories (business_id, COALESCE(parent_id::text, ''), name);
CREATE INDEX categories_business_order_idx
  ON categories (business_id, sort_order, name);

CREATE TABLE brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);

CREATE UNIQUE INDEX brands_unique_name_idx
  ON brands (business_id, name);

CREATE TABLE units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses (id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (btrim(code) <> '' AND char_length(code) <= 20),
  name TEXT NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  decimals_ok BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX units_unique_code_idx
  ON units (COALESCE(business_id::text, ''), code);
CREATE INDEX units_business_scope_idx
  ON units (business_id, is_system, name);

INSERT INTO units (id, business_id, code, name, decimals_ok, is_system, is_active)
VALUES
  ('00000000-0000-4000-8000-000000000001', NULL, 'bag', 'Bag', FALSE, TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000002', NULL, 'pc', 'Piece', FALSE, TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000003', NULL, 'm', 'Metre', TRUE, TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000004', NULL, 'cm', 'Centimetre', TRUE, TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000005', NULL, 'kg', 'Kilogram', TRUE, TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000006', NULL, 'g', 'Gram', TRUE, TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000007', NULL, 'l', 'Litre', TRUE, TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000008', NULL, 'ml', 'Millilitre', TRUE, TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000009', NULL, 'm2', 'Square metre', TRUE, TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000010', NULL, 'roll', 'Roll', FALSE, TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000011', NULL, 'bdl', 'Bundle', FALSE, TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000012', NULL, 'bkt', 'Bucket', FALSE, TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000013', NULL, 'pck', 'Pack', FALSE, TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000014', NULL, 't', 'Ton', TRUE, TRUE, TRUE);
