-- Branch-scoped stock balances, movements, and FIFO purchase-cost layers.
-- Quantities use thousandths of the product base unit; money uses hundredths of RWF.

CREATE TABLE inventory_balances (
  business_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity_on_hand BIGINT NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  average_unit_cost BIGINT NOT NULL DEFAULT 0 CHECK (average_unit_cost >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, branch_id, product_id),
  FOREIGN KEY (business_id, branch_id)
    REFERENCES branches (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, product_id)
    REFERENCES products (business_id, id) ON DELETE CASCADE
);

CREATE INDEX inventory_balances_branch_quantity_idx
  ON inventory_balances (business_id, branch_id, quantity_on_hand);

CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  product_id UUID NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'opening_stock',
    'purchase_received',
    'sale',
    'customer_return',
    'supplier_return',
    'damaged_stock',
    'stock_correction',
    'stock_transfer',
    'manual_adjustment'
  )),
  quantity_delta BIGINT NOT NULL,
  unit_cost BIGINT CHECK (unit_cost IS NULL OR unit_cost >= 0),
  total_cost BIGINT CHECK (total_cost IS NULL OR total_cost >= 0),
  previous_quantity BIGINT NOT NULL CHECK (previous_quantity >= 0),
  new_quantity BIGINT NOT NULL CHECK (new_quantity >= 0),
  reference_type TEXT,
  reference_id TEXT,
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 500),
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (new_quantity = previous_quantity + quantity_delta),
  UNIQUE (business_id, branch_id, id),
  FOREIGN KEY (business_id, branch_id)
    REFERENCES branches (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, product_id)
    REFERENCES products (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, user_id)
    REFERENCES users (business_id, id)
);

CREATE UNIQUE INDEX stock_movements_opening_once_idx
  ON stock_movements (business_id, branch_id, product_id)
  WHERE movement_type = 'opening_stock';
CREATE INDEX stock_movements_branch_created_idx
  ON stock_movements (business_id, branch_id, created_at DESC, id DESC);
CREATE INDEX stock_movements_product_created_idx
  ON stock_movements (business_id, branch_id, product_id, created_at DESC, id DESC);

CREATE TABLE inventory_cost_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  product_id UUID NOT NULL,
  source_movement_id UUID,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'opening_stock',
    'purchase_received',
    'stock_correction',
    'customer_return',
    'stock_transfer',
    'manual_adjustment'
  )),
  quantity_received BIGINT NOT NULL CHECK (quantity_received > 0),
  quantity_remaining BIGINT NOT NULL
    CHECK (quantity_remaining >= 0 AND quantity_remaining <= quantity_received),
  unit_cost BIGINT NOT NULL CHECK (unit_cost >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, branch_id)
    REFERENCES branches (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, product_id)
    REFERENCES products (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, branch_id, source_movement_id)
    REFERENCES stock_movements (business_id, branch_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX inventory_cost_layers_source_idx
  ON inventory_cost_layers (business_id, branch_id, source_movement_id)
  WHERE source_movement_id IS NOT NULL;
CREATE INDEX inventory_cost_layers_fifo_idx
  ON inventory_cost_layers (business_id, branch_id, product_id, created_at, id)
  WHERE quantity_remaining > 0;
