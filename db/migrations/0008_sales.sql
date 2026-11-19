-- Sales, POS payments and customer credit.
-- Quantities use thousandths of the base unit; money uses hundredths of RWF.

CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  branch_id UUID NOT NULL,
  transaction_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'cancelled')),
  subtotal BIGINT NOT NULL CHECK (subtotal >= 0),
  discount BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total BIGINT NOT NULL CHECK (total >= 0),
  sold_by UUID,
  customer_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, branch_id, transaction_number),
  FOREIGN KEY (business_id, branch_id)
    REFERENCES branches (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, sold_by)
    REFERENCES users (business_id, id),
  FOREIGN KEY (business_id, customer_id)
    REFERENCES customers (business_id, id)
);

CREATE INDEX sales_business_created_idx
  ON sales (business_id, branch_id, created_at DESC);
CREATE INDEX sales_customer_created_idx
  ON sales (business_id, customer_id, created_at DESC);

CREATE TABLE sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  sale_id UUID NOT NULL,
  product_id UUID NOT NULL,
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  unit_name TEXT NOT NULL,
  listed_unit_price BIGINT NOT NULL CHECK (listed_unit_price >= 0),
  unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
  line_total BIGINT NOT NULL CHECK (line_total >= 0),
  price_change_reason TEXT
    CHECK (price_change_reason IS NULL OR char_length(price_change_reason) <= 500),
  unit_cost BIGINT NOT NULL CHECK (unit_cost >= 0),
  total_cost BIGINT NOT NULL CHECK (total_cost >= 0),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, sale_id)
    REFERENCES sales (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, product_id)
    REFERENCES products (business_id, id)
);

CREATE INDEX sale_items_sale_idx ON sale_items (business_id, sale_id);
CREATE INDEX sale_items_product_idx ON sale_items (business_id, product_id);

CREATE TABLE sale_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  sale_id UUID NOT NULL,
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('cash', 'mtn_mobile_money', 'airtel_money', 'bank_transfer')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, sale_id)
    REFERENCES sales (business_id, id) ON DELETE CASCADE
);

CREATE INDEX sale_payments_sale_idx
  ON sale_payments (business_id, sale_id, created_at DESC);

CREATE TABLE customer_debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  sale_id UUID NOT NULL,
  original_amount BIGINT NOT NULL CHECK (original_amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, sale_id),
  FOREIGN KEY (business_id, customer_id)
    REFERENCES customers (business_id, id),
  FOREIGN KEY (business_id, sale_id)
    REFERENCES sales (business_id, id) ON DELETE CASCADE
);

CREATE INDEX customer_debts_customer_idx
  ON customer_debts (business_id, customer_id, created_at DESC);
