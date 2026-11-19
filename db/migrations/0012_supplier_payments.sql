-- Supplier invoice payments are business-scoped cash outflows.

CREATE TABLE purchase_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  purchase_id UUID NOT NULL,
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('cash', 'mtn_mobile_money', 'airtel_money', 'bank_transfer')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cash_account_id UUID NOT NULL,
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, purchase_id)
    REFERENCES purchases (business_id, id),
  FOREIGN KEY (business_id, cash_account_id)
    REFERENCES cash_accounts (business_id, id)
);

CREATE INDEX purchase_payments_purchase_idx
  ON purchase_payments (business_id, purchase_id, created_at DESC, id);

CREATE FUNCTION validate_supplier_payment_account() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM purchases p
    JOIN cash_accounts a
      ON a.business_id = p.business_id AND a.id = NEW.cash_account_id
    JOIN cash_account_openings o
      ON o.business_id = a.business_id AND o.account_id = a.id
    WHERE p.business_id = NEW.business_id AND p.id = NEW.purchase_id
      AND a.is_active = TRUE
      AND (a.branch_id IS NULL OR a.branch_id = p.branch_id)
      AND a.account_type = CASE NEW.payment_method
        WHEN 'cash' THEN 'cash_drawer'
        WHEN 'bank_transfer' THEN 'bank'
        WHEN 'mtn_mobile_money' THEN 'mtn_wallet'
        WHEN 'airtel_money' THEN 'airtel_wallet'
      END
  ) THEN
    RAISE EXCEPTION 'supplier payment requires an active, opened account matching its payment method and branch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_supplier_payment_account
BEFORE INSERT ON purchase_payments
FOR EACH ROW EXECUTE FUNCTION validate_supplier_payment_account();

CREATE UNIQUE INDEX cash_movements_purchase_payment_source_idx
  ON cash_movements (business_id, source_id)
  WHERE source_type = 'purchase_payment';

CREATE FUNCTION validate_supplier_payment_cash_movement_source() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.source_type = 'purchase_payment' OR NEW.movement_type = 'supplier_payment')
    AND NOT EXISTS (
      SELECT 1
      FROM purchase_payments p
      WHERE p.id = NEW.source_id AND p.business_id = NEW.business_id
        AND p.cash_account_id = NEW.account_id
        AND p.amount = NEW.amount AND p.created_at = NEW.recorded_at
        AND NEW.source_type = 'purchase_payment'
        AND NEW.movement_type = 'supplier_payment'
        AND NEW.direction = 'out'
    ) THEN
    RAISE EXCEPTION 'supplier payment movement must match its recorded payment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_supplier_payment_cash_movement_source
BEFORE INSERT ON cash_movements
FOR EACH ROW EXECUTE FUNCTION validate_supplier_payment_cash_movement_source();
