-- POS collections must be assigned to an opened account and posted to its ledger.

ALTER TABLE sale_payments
  ADD COLUMN cash_account_id UUID;

ALTER TABLE sale_payments
  ADD CONSTRAINT sale_payments_cash_account_fk
  FOREIGN KEY (business_id, cash_account_id)
  REFERENCES cash_accounts (business_id, id);

CREATE INDEX sale_payments_cash_account_idx
  ON sale_payments (business_id, cash_account_id, created_at DESC)
  WHERE cash_account_id IS NOT NULL;

WITH account_candidates AS (
  SELECT sp.business_id, sp.id AS sale_payment_id, a.id AS cash_account_id,
         a.is_active,
         COUNT(*) OVER (PARTITION BY sp.business_id, sp.id) AS candidate_count
  FROM sale_payments sp
  JOIN sales s
    ON s.business_id = sp.business_id AND s.id = sp.sale_id
  JOIN cash_accounts a
    ON a.business_id = sp.business_id
   AND a.account_type = CASE sp.payment_method
     WHEN 'cash' THEN 'cash_drawer'
     WHEN 'bank_transfer' THEN 'bank'
     WHEN 'mtn_mobile_money' THEN 'mtn_wallet'
     WHEN 'airtel_money' THEN 'airtel_wallet'
   END
   AND (a.branch_id IS NULL OR a.branch_id = s.branch_id)
  JOIN cash_account_openings o
    ON o.business_id = a.business_id AND o.account_id = a.id
  WHERE sp.cash_account_id IS NULL
    AND s.status = 'completed'
    AND a.created_at <= sp.created_at
    AND o.opened_at <= sp.created_at
)
UPDATE sale_payments sp
SET cash_account_id = candidates.cash_account_id
FROM account_candidates candidates
WHERE candidates.business_id = sp.business_id
  AND candidates.sale_payment_id = sp.id
  AND candidates.candidate_count = 1
  AND candidates.is_active = TRUE;

INSERT INTO cash_movements
  (business_id, account_id, movement_type, direction, amount, source_type,
   source_id, recorded_at, responsible_user_id, description)
SELECT sp.business_id, sp.cash_account_id, 'sale_collection', 'in', sp.amount,
       'sale_payment', sp.id, sp.created_at, s.sold_by,
       'Sale ' || s.transaction_number
FROM sale_payments sp
JOIN sales s ON s.business_id = sp.business_id AND s.id = sp.sale_id
WHERE sp.cash_account_id IS NOT NULL
  AND s.status = 'completed'
  AND NOT EXISTS (
    SELECT 1
    FROM cash_movements cm
    WHERE cm.business_id = sp.business_id
      AND cm.source_id = sp.id
      AND cm.source_type = 'sale_payment'
  );

CREATE FUNCTION validate_sale_payment_account() RETURNS trigger
LANGUAGE plpgsql
AS
$$
BEGIN
  IF NEW.cash_account_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM sales s
    JOIN cash_accounts a
      ON a.business_id = s.business_id AND a.id = NEW.cash_account_id
    JOIN cash_account_openings o
      ON o.business_id = a.business_id AND o.account_id = a.id
    WHERE s.business_id = NEW.business_id AND s.id = NEW.sale_id
      AND a.is_active = TRUE
      AND (a.branch_id IS NULL OR a.branch_id = s.branch_id)
      AND a.account_type = CASE NEW.payment_method
        WHEN 'cash' THEN 'cash_drawer'
        WHEN 'bank_transfer' THEN 'bank'
        WHEN 'mtn_mobile_money' THEN 'mtn_wallet'
        WHEN 'airtel_money' THEN 'airtel_wallet'
      END
  ) THEN
    RAISE EXCEPTION 'sale payment requires an active, opened account matching its payment method and branch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_sale_payment_account
BEFORE INSERT OR UPDATE ON sale_payments
FOR EACH ROW EXECUTE FUNCTION validate_sale_payment_account();

CREATE UNIQUE INDEX cash_movements_sale_payment_source_idx
  ON cash_movements (business_id, source_id)
  WHERE source_type = 'sale_payment';

CREATE FUNCTION validate_sale_payment_cash_movement_source() RETURNS trigger
LANGUAGE plpgsql
AS
$$
BEGIN
  IF (NEW.source_type = 'sale_payment' OR NEW.movement_type = 'sale_collection')
    AND NOT EXISTS (
      SELECT 1
      FROM sale_payments p
      WHERE p.id = NEW.source_id AND p.business_id = NEW.business_id
        AND p.cash_account_id = NEW.account_id
        AND p.amount = NEW.amount AND p.created_at = NEW.recorded_at
        AND NEW.source_type = 'sale_payment'
        AND NEW.movement_type = 'sale_collection'
        AND NEW.direction = 'in'
    ) THEN
    RAISE EXCEPTION 'sale collection movement must match its recorded payment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_sale_payment_cash_movement_source
BEFORE INSERT ON cash_movements
FOR EACH ROW EXECUTE FUNCTION validate_sale_payment_cash_movement_source();
