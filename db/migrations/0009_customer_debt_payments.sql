-- Later repayments against credit sales.
-- Sale-time collections remain in sale_payments.

CREATE TABLE customer_debt_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  debt_id UUID NOT NULL,
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('cash', 'mtn_mobile_money', 'airtel_money', 'bank_transfer')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, debt_id)
    REFERENCES customer_debts (business_id, id) ON DELETE CASCADE
);

CREATE INDEX customer_debt_payments_debt_idx
  ON customer_debt_payments (business_id, debt_id, created_at DESC);
