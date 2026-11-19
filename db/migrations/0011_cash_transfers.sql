CREATE TABLE cash_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  from_account_id UUID NOT NULL,
  to_account_id UUID NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  occurred_at TIMESTAMPTZ NOT NULL,
  initiated_by_user_id UUID NOT NULL,
  confirmed_by_user_id UUID,
  confirmed_at TIMESTAMPTZ,
  cancelled_by_user_id UUID,
  cancelled_at TIMESTAMPTZ,
  confirmation_reference TEXT
    CHECK (confirmation_reference IS NULL OR char_length(confirmation_reference) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, from_account_id)
    REFERENCES cash_accounts (business_id, id),
  FOREIGN KEY (business_id, to_account_id)
    REFERENCES cash_accounts (business_id, id),
  FOREIGN KEY (business_id, initiated_by_user_id)
    REFERENCES users (business_id, id),
  FOREIGN KEY (business_id, confirmed_by_user_id)
    REFERENCES users (business_id, id),
  FOREIGN KEY (business_id, cancelled_by_user_id)
    REFERENCES users (business_id, id),
  CHECK (from_account_id <> to_account_id),
  CHECK (
    (status = 'pending'
      AND confirmed_by_user_id IS NULL AND confirmed_at IS NULL
      AND cancelled_by_user_id IS NULL AND cancelled_at IS NULL)
    OR
    (status = 'confirmed'
      AND confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL
      AND cancelled_by_user_id IS NULL AND cancelled_at IS NULL)
    OR
    (status = 'cancelled'
      AND confirmed_by_user_id IS NULL AND confirmed_at IS NULL
      AND cancelled_by_user_id IS NOT NULL AND cancelled_at IS NOT NULL)
  )
);

CREATE INDEX cash_transfers_business_status_idx
  ON cash_transfers (business_id, status, occurred_at DESC);
