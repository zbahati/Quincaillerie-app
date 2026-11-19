-- Purchase invoices and branch deliveries.
-- Quantities use thousandths of the base unit; money uses hundredths of RWF.

CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  branch_id UUID NOT NULL,
  supplier_id UUID NOT NULL,
  supplier_invoice_number TEXT NOT NULL
    CHECK (btrim(supplier_invoice_number) <> '' AND char_length(supplier_invoice_number) <= 200),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'partially_received', 'received')),
  subtotal BIGINT NOT NULL CHECK (subtotal >= 0),
  duplicate_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of_purchase_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, branch_id)
    REFERENCES branches (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, supplier_id)
    REFERENCES suppliers (business_id, id),
  FOREIGN KEY (business_id, duplicate_of_purchase_id)
    REFERENCES purchases (business_id, id)
);

CREATE INDEX purchases_duplicate_invoice_idx
  ON purchases (business_id, branch_id, supplier_id, upper(supplier_invoice_number));
CREATE INDEX purchases_business_created_idx
  ON purchases (business_id, created_at DESC);

CREATE TABLE purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  purchase_id UUID NOT NULL,
  product_id UUID NOT NULL,
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  unit_name TEXT NOT NULL,
  ordered_quantity BIGINT NOT NULL CHECK (ordered_quantity > 0),
  received_quantity BIGINT NOT NULL DEFAULT 0
    CHECK (received_quantity >= 0 AND received_quantity <= ordered_quantity),
  unit_cost BIGINT NOT NULL CHECK (unit_cost >= 0),
  line_total BIGINT NOT NULL CHECK (line_total >= 0),
  UNIQUE (business_id, purchase_id, product_id),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, purchase_id)
    REFERENCES purchases (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, product_id)
    REFERENCES products (business_id, id)
);

CREATE INDEX purchase_items_purchase_idx
  ON purchase_items (business_id, purchase_id);

CREATE TABLE purchase_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  purchase_id UUID NOT NULL,
  delivery_reference TEXT CHECK (delivery_reference IS NULL OR char_length(delivery_reference) <= 200),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, branch_id)
    REFERENCES branches (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, purchase_id)
    REFERENCES purchases (business_id, id) ON DELETE CASCADE
);

CREATE INDEX purchase_receipts_purchase_idx
  ON purchase_receipts (business_id, branch_id, purchase_id, created_at DESC);

CREATE TABLE purchase_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  receipt_id UUID NOT NULL,
  purchase_item_id UUID NOT NULL,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  unit_cost BIGINT NOT NULL CHECK (unit_cost >= 0),
  total_cost BIGINT NOT NULL CHECK (total_cost >= 0),
  UNIQUE (receipt_id, purchase_item_id),
  FOREIGN KEY (business_id, receipt_id)
    REFERENCES purchase_receipts (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, purchase_item_id)
    REFERENCES purchase_items (business_id, id)
);
