-- Customer debt repayments must be assigned to an opened branch account.

ALTER TABLE customer_debt_payments
  ADD COLUMN cash_account_id UUID;

ALTER TABLE customer_debt_payments
  ADD CONSTRAINT customer_debt_payments_cash_account_fk
  FOREIGN KEY (business_id, cash_account_id)
  REFERENCES cash_accounts (business_id, id);

CREATE INDEX customer_debt_payments_cash_account_idx
  ON customer_debt_payments (business_id, cash_account_id, created_at DESC)
  WHERE cash_account_id IS NOT NULL;

CREATE FUNCTION validate_customer_debt_payment_account() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cash_account_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM customer_debts d
    JOIN sales s
      ON s.business_id = d.business_id AND s.id = d.sale_id
    JOIN customers c
      ON c.business_id = d.business_id AND c.id = d.customer_id
    JOIN cash_accounts a
      ON a.business_id = s.business_id AND a.id = NEW.cash_account_id
    JOIN cash_account_openings o
      ON o.business_id = a.business_id AND o.account_id = a.id
    WHERE d.business_id = NEW.business_id AND d.id = NEW.debt_id
      AND c.branch_id = s.branch_id
      AND a.is_active = TRUE
      AND a.branch_id = s.branch_id
      AND a.account_type = CASE NEW.payment_method
        WHEN 'cash' THEN 'cash_drawer'
        WHEN 'bank_transfer' THEN 'bank'
        WHEN 'mtn_mobile_money' THEN 'mtn_wallet'
        WHEN 'airtel_money' THEN 'airtel_wallet'
      END
  ) THEN
    RAISE EXCEPTION 'customer repayment requires an active, opened account matching its payment method and branch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_customer_debt_payment_account
BEFORE INSERT OR UPDATE ON customer_debt_payments
FOR EACH ROW EXECUTE FUNCTION validate_customer_debt_payment_account();

CREATE UNIQUE INDEX cash_movements_customer_debt_payment_source_idx
  ON cash_movements (business_id, source_id)
  WHERE source_type = 'customer_debt_payment';

CREATE FUNCTION validate_customer_debt_payment_cash_movement_source() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.source_type = 'customer_debt_payment' OR NEW.movement_type = 'customer_repayment')
    AND NOT EXISTS (
      SELECT 1
      FROM customer_debt_payments p
      WHERE p.id = NEW.source_id AND p.business_id = NEW.business_id
        AND p.cash_account_id = NEW.account_id
        AND p.amount = NEW.amount AND p.created_at = NEW.recorded_at
        AND NEW.source_type = 'customer_debt_payment'
        AND NEW.movement_type = 'customer_repayment'
        AND NEW.direction = 'in'
    ) THEN
    RAISE EXCEPTION 'customer repayment movement must match its recorded payment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_customer_debt_payment_cash_movement_source
BEFORE INSERT ON cash_movements
FOR EACH ROW EXECUTE FUNCTION validate_customer_debt_payment_cash_movement_source();
