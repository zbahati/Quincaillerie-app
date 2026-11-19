-- Customer debt is the amount due after sale-time collections.
-- Older POS versions stored the full sale total instead.
UPDATE customer_debts d
SET original_amount = LEAST(
  d.original_amount,
  GREATEST(
    s.total - COALESCE((
      SELECT SUM(sp.amount)
      FROM sale_payments sp
      WHERE sp.business_id = s.business_id AND sp.sale_id = s.id
    ), 0),
    0
  )
)
FROM sales s
WHERE s.business_id = d.business_id
  AND s.id = d.sale_id
  AND d.original_amount > GREATEST(
    s.total - COALESCE((
      SELECT SUM(sp.amount)
      FROM sale_payments sp
      WHERE sp.business_id = s.business_id AND sp.sale_id = s.id
    ), 0),
    0
  )
  AND GREATEST(
    s.total - COALESCE((
      SELECT SUM(sp.amount)
      FROM sale_payments sp
      WHERE sp.business_id = s.business_id AND sp.sale_id = s.id
    ), 0),
    0
  ) > 0;
