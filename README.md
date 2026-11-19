# Quincaillerie Manager Web

This folder is the separate Next.js web application. The existing Tauri desktop application remains unchanged in `../inventory-app-kivu/`.

## Current checkpoint

Tasks 2.1–2.5, 3.1–3.3, and Tasks 6.1–6.18 are complete. The app has online Admin bootstrap with email verification, Admin/Manager sign-in, database-backed sessions, Admin email password recovery, rate limits, audit records, and business/branch/permission authorization.

Task 6.2's PostgreSQL integration suite passed against a fresh disposable database: 4 tests passed. TypeScript, targeted ESLint, all 8 unit tests, and the production build passed. Browser inspection confirmed the authenticated desktop-style shell and Settings view for both Admin and Manager sessions. It also exposed and fixed a logout-state issue where a restored session could lead to the first-Admin setup screen rather than the existing-business sign-in form.

The auth gate is mounted for application routes. The Employees screen provides Admin-only business-profile edits, branch creation/edit/activation, Manager creation, reassignment, activation/deactivation, password reset and permission configuration through same-origin server APIs. New branches start inactive and require an active Manager before activation. Each branch/Manager mutation serializes on the business row and checks that every active branch remains covered; affected Manager sessions are revoked when access or assignment changes.

The Settings screen is web-adapted for the signed-in business: permitted users can view business details, authorized Admins can update the name and tax ID, and catalog permissions govern category, brand and unit listing/creation. Categories support a parent/subcategory hierarchy; global system units and business-specific units are both listed. The business, category, brand and unit APIs are scoped by the session rather than a client-supplied business ID. Native SQLite backup/restore and first-run business creation are not part of this web screen. Other copied feature screens remain gated where their services still depend on Tauri; no demo user or business data is shown.

The Products screen is active at `/products`, adapted from the copied desktop UI and backed by business-scoped PostgreSQL product, selling-unit, and price-history APIs. Admins can manage products; Managers need the relevant catalogue permissions, and read-only Managers can browse without mutation controls. Admin and read-only Manager browser views were verified.

The Inventory screen is active at `/inventory`, adapted from the copied desktop UI and backed by branch-scoped PostgreSQL balances, movements, and FIFO cost layers (`0005_branch_inventory.sql`). Admins select a branch; Managers are restricted to their assigned branch, and write controls follow `inventory.manage`. The web slice supports opening stock, corrections, delivery receipts, movement history, and selling-price floors based on the highest remaining cost layer across the business. Task 6.4 passed TypeScript, targeted ESLint, all 8 unit tests, all 6 PostgreSQL integration tests on a disposable PostgreSQL 17 database, a production build, and browser verification with synthetic data. Browser checks confirmed Admin branch selection and refreshed balances, opening-stock/receipt/correction workflows and movement history, plus Manager branch-only and read-only inventory controls. Offline device enrollment/synchronization and the remaining Tauri-backed feature screens are future work.

The Suppliers and Customers screens are active at `/suppliers` and `/customers`, backed by business-scoped PostgreSQL directories (`0006_suppliers_customers.sql`). Supplier and customer create/edit controls follow `suppliers.manage` and `customers.manage`; directory reads follow their corresponding read permissions. The desktop field shapes, active-state behavior, exact hundredths-of-RWF customer credit limits, and search behavior are preserved. Customer statements and outstanding balances remain deferred until the sales and customer-debt slices exist. Task 6.5 passed the full 7-test PostgreSQL integration suite, TypeScript, targeted ESLint, 8 unit tests, production build, and browser verification with synthetic Admin-created supplier and customer records.

The Purchases screen is active at `/purchases`, backed by branch-scoped PostgreSQL invoice, receipt, and supplier-payment records (`0007_purchases.sql`, `0012_supplier_payments.sql`). It preserves supplier invoice numbers, duplicate confirmation, exact thousandths for quantities and hundredths for RWF costs, one product per line, and partial or complete deliveries. Receiving stock updates branch inventory/FIFO cost layers; supplier payments require a method-matched, opened account with sufficient funds and atomically post an immutable cash-ledger movement and audit record. Payments are branch-scoped and online-only. Purchase History is active at `/purchase-history` and lists only fully received and fully paid invoices, with branch selection, search, date filters, pagination, totals and purchase/payment/delivery details.

The Point of Sale screen is active at `/pos`, backed by branch-scoped PostgreSQL sales and customer debt records (`0008_sales.sql`). It supports product search, cart quantities, listed and overridden selling prices, below-FIFO-cost authorization reasons, single or split payment methods, active-customer credit limits, stock/FIFO consumption and receipt output. Credit debt records the unpaid balance after checkout collections, and later repayments cannot exceed that balance. Each collected sale payment is assigned to an active, opened account that matches its method and branch, then posted as an incoming cash-ledger movement in the same transaction. Cash, bank and wallet balances therefore reflect sales collections immediately.

The Sales History screen is active at `/sales`, backed by the same branch-scoped PostgreSQL sales and sale-line/payment snapshots. It supports transaction/customer/product/SKU search, date range filtering, 30-row pagination, completed-sales totals and collected totals, plus an exact sale-detail dialog. No desktop data is imported.

Customer debts and statements are active at `/payments` and `/customers`. Credit-sale balances are reconciled with sale-time payments and later repayment records (`0009_customer_debt_payments.sql`), exact overpayment protection is enforced, Manager payment access follows `customer_payments.manage`, and customer statements show sale/payment/repayment history with running balances.

Cash accounts and expenses are active at `/cash-accounts` and `/expenses`, backed by `0010_cash_accounts_expenses.sql`. Admins can create accounts and authorize immutable opening balances; available balances include account movements. POS collections, expenses and supplier payments require an active, opened, payment-method-matched account and create their records and ledger movements atomically. Expenses and supplier payments also require sufficient verified funds.

Cash transfers are active at `/cash-accounts`, backed by `0011_cash_transfers.sql`. Transfers start pending and do not change balances. Admin confirmation atomically posts a transfer-out and transfer-in movement to the source and destination accounts and rejects insufficient funds or unavailable accounts.

Financial statements are active at `/reports/income` and `/reports/balance-sheet`. The income statement uses completed sales and persisted sale-item cost snapshots for COGS; the balance sheet reports cash, historical inventory, receivables, supplier payables, and retained earnings from supported ledger data. Supplier payable reductions are reconciled through purchase-payment records matched to posted supplier-payment movements. Unassigned business-wide expenses are included in each selected branch view. Owner equity is a balancing figure because owner contributions and withdrawals are not recorded; loan accounts are unsupported, so the displayed zero difference is not an independent accounting reconciliation.

Business Admins can download a versioned, business-scoped JSON data export from Settings. It streams operational records, preserves PostgreSQL integer amounts as exact strings, and records the export in the business audit log. Password hashes, sessions, verification/reset tokens and rate-limit state are excluded. The export contains sensitive customer, supplier, staff and financial data and must be stored securely. It is not a full PostgreSQL backup and cannot be restored through the app; database backup and restore remain deployment-operator responsibilities.

Never import files from `../inventory-app-kivu/` at runtime or edit that desktop project. Adapt only the copies in this project; keep backend/data access server-side.

## Commands

```powershell
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` uses Node's built-in test runner. `npm run test:integration` requires `TEST_DATABASE_URL` to point to a disposable PostgreSQL database with all migrations applied. The integration suite runs sequentially to isolate shared PostgreSQL rate-limit and auth state; it covers repository transactions, auth routes/cookies, branch/Manager coverage and isolation, business settings and export, catalog permissions/tenant scope, product and selling-unit rules, price history, inventory branch scope, FIFO costing, receipts, price floors and movement audit, cash transfers, financial statements, rate limits, and session revocation. Never point integration tests at production data.

## Local containers

Copy `.env.example` to `.env`, then change the local development password before starting the stack:

```powershell
Copy-Item .env.example .env
docker compose -p quincaillerie-web-dev up --build
```

The web app is available at `http://localhost:3000`; PostgreSQL is bound to localhost on port `5432`. Compose waits for PostgreSQL health and applies the checksum-tracked SQL migrations before starting the web container. Migrations `0001_web_identity_auth.sql` through `0014_customer_debt_balance.sql` cover identity/auth, Settings, products, branch inventory, suppliers/customers, purchases, sales/customer debts, cash accounts/expenses, cash transfers, supplier payments, POS cash collections and correction of legacy debt balances.

To run Next.js directly on Windows with `npm run dev`, keep the Docker-only `DATABASE_URL` in `.env` for Compose and set a host-reachable URL in `.env.local`. If port `5432` is already in use, choose a free host port (for example `55449`) for `POSTGRES_PORT` in `.env` and use the same port in `.env.local`:

```dotenv
# .env.local — use the same username, password and database as .env
DATABASE_URL=postgresql://quincaillerie:<password>@127.0.0.1:55449/quincaillerie
WEB_BASE_URL=http://localhost:3013
```

Start the database and apply migrations before starting Next.js:

```powershell
docker compose -p quincaillerie-web-dev up -d db
docker compose -p quincaillerie-web-dev run --rm migrate
npm run dev -- --port 3013
```

Open the exact origin configured by `WEB_BASE_URL`. Without `DATABASE_URL`, the health endpoint may work but sign-in/business-list APIs cannot connect to PostgreSQL.

For verification and recovery email, configure `WEB_BASE_URL`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL` in `.env`. `WEB_BASE_URL` must be the exact browser origin used for same-origin request checks and email links. The Resend sender must be verified with Resend. If these email settings are missing or invalid, Admin bootstrap still creates a pending, unverified account but reports that delivery failed; configure email and request a new verification link. Password-reset and verification-request responses intentionally do not reveal whether an email matched an account.

Auth sessions use an HttpOnly, SameSite=Lax cookie (Secure in production), are stored server-side as token hashes, and expire after seven days. The browser does not store session tokens in local storage. Offline device enrollment and offline authorization/cache behavior are not implemented yet.

The browser build includes an install manifest, app icons and a same-origin service worker. The worker caches only static assets and public app-shell responses; `/api/*`, verification, password-reset and other private/auth responses are never written to CacheStorage. Offline navigation shows an explicit fallback page and the UI marks server-backed actions as requiring reconnection. This is shell/install support, not offline POS writes or offline data synchronization; those remain deferred until the approved Phase 4 implementation.

Global response headers include CSP, frame protection, MIME sniffing protection, referrer policy, Permissions-Policy and same-origin opener protection. Production responses also include HSTS. CSP still permits inline scripts/styles and development WebSockets for Next.js compatibility; production CSP nonce hardening and a trusted-proxy/IP throttle remain deployment follow-ups.

Use `docker compose -p quincaillerie-web-dev down` to stop the stack while preserving the database volume. Do not remove the volume unless you intend to delete the local database. Stop the host `npm run dev` server before starting the Compose web service on the same host port. The Docker image uses Next.js standalone output and runs as a non-root user; production secrets and deployment settings are not included in this development Compose file.

The production Docker image includes a database-aware `/api/health` check. It returns HTTP 200 only when PostgreSQL is reachable and HTTP 503 otherwise. See [DEPLOYMENT.md](./DEPLOYMENT.md) for staging, HTTPS, migration, backup, restore, monitoring and rollback guidance.
#   Q u i n c a i l l e r i e - a p p  
 