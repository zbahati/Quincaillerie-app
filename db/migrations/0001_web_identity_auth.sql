-- Web identity, business, branch and authorization foundation.
-- This schema is new; no desktop SQLite data is imported.

CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  tax_id TEXT,
  currency TEXT NOT NULL DEFAULT 'RWF',
  timezone TEXT NOT NULL DEFAULT 'Africa/Kigali',
  date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  language TEXT NOT NULL DEFAULT 'en',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  address TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);

CREATE INDEX branches_business_idx ON branches (business_id);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id),
  branch_id UUID,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager')),
  username TEXT NOT NULL
    CHECK (
      username = lower(btrim(username))
      AND username ~ '^[a-z0-9._-]{3,32}$'
    ),
  full_name TEXT NOT NULL
    CHECK (btrim(full_name) <> '' AND char_length(full_name) <= 120),
  email TEXT,
  email_verified_at TIMESTAMPTZ,
  password_hash TEXT NOT NULL CHECK (password_hash <> ''),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  CONSTRAINT users_business_branch_fk
    FOREIGN KEY (business_id, branch_id) REFERENCES branches (business_id, id),
  CONSTRAINT users_role_branch_check
    CHECK (
      (role = 'admin' AND branch_id IS NULL)
      OR (role = 'manager' AND branch_id IS NOT NULL)
    ),
  CONSTRAINT users_admin_email_check
    CHECK (role <> 'admin' OR email IS NOT NULL),
  CONSTRAINT users_email_normalized_check
    CHECK (
      email IS NULL
      OR (
        email = lower(btrim(email))
        AND email <> ''
        AND char_length(email) <= 254
      )
    ),
  CONSTRAINT users_email_verification_check
    CHECK (email IS NOT NULL OR email_verified_at IS NULL)
);

CREATE UNIQUE INDEX users_business_username_idx
  ON users (business_id, username);
CREATE UNIQUE INDEX users_one_admin_per_business_idx
  ON users (business_id)
  WHERE role = 'admin';
CREATE INDEX users_business_branch_idx
  ON users (business_id, branch_id);

CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

INSERT INTO permissions (id, description) VALUES
  ('system.read', 'Read basic application information'),
  ('business.read', 'View business configuration'),
  ('business.manage', 'Create and manage business configuration'),
  ('employees.manage', 'Manage employee profiles and access'),
  ('cash_accounts.manage', 'Manage cash, bank and mobile-money accounts'),
  ('catalog.read', 'View product catalog, categories, brands and units'),
  ('catalog.manage', 'Manage products, categories, brands and units'),
  ('inventory.read', 'View stock levels and movement history'),
  ('inventory.manage', 'Adjust stock and receive inventory'),
  ('suppliers.read', 'View supplier records'),
  ('suppliers.manage', 'Manage supplier records'),
  ('customers.read', 'View customer records'),
  ('customers.manage', 'Manage customer records'),
  ('customer_debts.read', 'View customer debt balances'),
  ('customer_payments.manage', 'Manage customer payments'),
  ('pos.use', 'Search products for checkout and record point-of-sale transactions'),
  ('sales.read', 'View sales records'),
  ('sales.manage', 'Record sales and customer payments'),
  ('purchases.read', 'View purchases and purchase costs'),
  ('purchases.manage', 'Manage purchases, deliveries and supplier payments'),
  ('expenses.read', 'View expenses'),
  ('expenses.manage', 'Manage expenses'),
  ('cash_accounts.balance.read', 'View cash-account balances'),
  ('reports.read', 'View business financial reports'),
  ('roles.manage', 'Configure Manager permissions');

CREATE TABLE manager_permission_catalog (
  permission_id TEXT PRIMARY KEY REFERENCES permissions (id),
  enabled_by_default BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO manager_permission_catalog (permission_id, enabled_by_default) VALUES
  ('system.read', TRUE),
  ('business.read', TRUE),
  ('cash_accounts.balance.read', TRUE),
  ('catalog.read', TRUE),
  ('catalog.manage', TRUE),
  ('inventory.read', TRUE),
  ('inventory.manage', TRUE),
  ('suppliers.read', TRUE),
  ('suppliers.manage', TRUE),
  ('customers.read', TRUE),
  ('customers.manage', TRUE),
  ('customer_debts.read', TRUE),
  ('customer_payments.manage', TRUE),
  ('pos.use', TRUE),
  ('sales.read', TRUE),
  ('sales.manage', TRUE),
  ('purchases.read', TRUE),
  ('purchases.manage', TRUE),
  ('expenses.read', TRUE),
  ('expenses.manage', TRUE);

CREATE TABLE business_manager_permissions (
  business_id UUID NOT NULL REFERENCES businesses (id),
  permission_id TEXT NOT NULL REFERENCES manager_permission_catalog (permission_id),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_user_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, permission_id),
  FOREIGN KEY (business_id, updated_by_user_id) REFERENCES users (business_id, id)
);

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  user_id UUID NOT NULL,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at),
  FOREIGN KEY (business_id, user_id)
    REFERENCES users (business_id, id) ON DELETE CASCADE
);

CREATE INDEX auth_sessions_active_user_idx
  ON auth_sessions (business_id, user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE admin_email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  user_id UUID NOT NULL,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK (expires_at > created_at),
  FOREIGN KEY (business_id, user_id)
    REFERENCES users (business_id, id) ON DELETE CASCADE
);

CREATE INDEX admin_email_verification_user_idx
  ON admin_email_verification_tokens (business_id, user_id, expires_at);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  user_id UUID NOT NULL,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK (expires_at > requested_at),
  FOREIGN KEY (business_id, user_id)
    REFERENCES users (business_id, id) ON DELETE CASCADE
);

CREATE INDEX password_reset_user_idx
  ON password_reset_tokens (business_id, user_id, expires_at);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id),
  user_id UUID,
  action TEXT NOT NULL CHECK (btrim(action) <> ''),
  entity_type TEXT,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, user_id) REFERENCES users (business_id, id)
);

CREATE INDEX audit_logs_business_created_idx
  ON audit_logs (business_id, created_at DESC);
CREATE INDEX audit_logs_user_created_idx
  ON audit_logs (user_id, created_at DESC);

-- Active-branch Manager coverage is enforced by the future service transaction.
-- The single branch_id on each Manager permits multiple Managers per branch.
