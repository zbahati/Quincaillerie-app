-- Business-scoped supplier and customer directories.
-- Customer credit limits use hundredths of RWF.

CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 160),
  contact_person TEXT CHECK (contact_person IS NULL OR char_length(contact_person) <= 160),
  phone TEXT CHECK (phone IS NULL OR char_length(phone) <= 80),
  email TEXT CHECK (email IS NULL OR char_length(email) <= 254),
  address TEXT CHECK (address IS NULL OR char_length(address) <= 500),
  tax_id TEXT CHECK (tax_id IS NULL OR char_length(tax_id) <= 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);

CREATE INDEX suppliers_business_directory_idx
  ON suppliers (business_id, is_active DESC, lower(name), id);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 160),
  phone TEXT CHECK (phone IS NULL OR char_length(phone) <= 80),
  address TEXT CHECK (address IS NULL OR char_length(address) <= 500),
  customer_type TEXT NOT NULL DEFAULT 'individual'
    CHECK (customer_type IN ('individual', 'business')),
  credit_limit BIGINT NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);

CREATE INDEX customers_business_directory_idx
  ON customers (business_id, is_active DESC, lower(name), id);
CREATE INDEX customers_business_phone_idx
  ON customers (business_id, phone);
