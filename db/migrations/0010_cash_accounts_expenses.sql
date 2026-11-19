-- Cash accounts, immutable openings, movements and account-backed expenses.

CREATE TABLE cash_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  branch_id UUID,
  account_type TEXT NOT NULL
    CHECK (account_type IN ('cash_drawer', 'bank', 'mtn_wallet', 'airtel_wallet', 'other')),
  name TEXT NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  responsible_user_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, branch_id)
    REFERENCES branches (business_id, id),
  FOREIGN KEY (business_id, responsible_user_id)
    REFERENCES users (business_id, id)
);

CREATE INDEX cash_accounts_business_active_idx
  ON cash_accounts (business_id, is_active, account_type);

CREATE TABLE cash_account_openings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  account_id UUID NOT NULL,
  opening_amount BIGINT NOT NULL CHECK (opening_amount >= 0),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  entered_by_user_id UUID NOT NULL,
  authorized_by_user_id UUID NOT NULL,
  UNIQUE (business_id, account_id),
  FOREIGN KEY (business_id, account_id)
    REFERENCES cash_accounts (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, entered_by_user_id)
    REFERENCES users (business_id, id),
  FOREIGN KEY (business_id, authorized_by_user_id)
    REFERENCES users (business_id, id)
);

CREATE TABLE cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  account_id UUID NOT NULL,
  movement_type TEXT NOT NULL
    CHECK (movement_type IN (
      'opening', 'sale_collection', 'customer_repayment', 'expense_payment',
      'supplier_payment', 'other_receipt', 'other_payment', 'transfer_in', 'transfer_out'
    )),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  source_type TEXT NOT NULL
    CHECK (source_type IN (
      'opening', 'sale_payment', 'customer_debt_payment', 'expense_payment',
      'purchase_payment', 'cash_transfer', 'other'
    )),
  source_id UUID,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responsible_user_id UUID,
  description TEXT,
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, account_id)
    REFERENCES cash_accounts (business_id, id),
  FOREIGN KEY (business_id, responsible_user_id)
    REFERENCES users (business_id, id)
);

CREATE INDEX cash_movements_account_idx
  ON cash_movements (business_id, account_id, recorded_at DESC);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  branch_id UUID,
  category TEXT NOT NULL
    CHECK (category IN ('rent', 'electricity', 'transport', 'salaries', 'internet', 'repairs', 'security', 'other')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL,
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('cash', 'mtn_mobile_money', 'airtel_money', 'bank_transfer')),
  cash_account_id UUID,
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1000),
  responsible_name TEXT NOT NULL CHECK (char_length(responsible_name) <= 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, branch_id)
    REFERENCES branches (business_id, id),
  FOREIGN KEY (business_id, cash_account_id)
    REFERENCES cash_accounts (business_id, id)
);

CREATE INDEX expenses_business_date_idx
  ON expenses (business_id, expense_date DESC, created_at DESC);
