# Quincaillerie Manager — Web/PWA Migration Guide

**Status:** Tasks 2.1-2.5, 3.1-3.3, and Tasks 6.1-6.19 implementation and automated validation are complete. Authenticated browser verification includes the Admin business-data export and the adapted Purchases/Purchase History routes. Phase 7.1 validation and Task 7.5 reconciliation review are complete; the Phase 7.2 visual route sweep, Phase 7.3 PWA shell/offline fallback checks, and Task 7.4 security-header review are complete. Phase 8 deployment-readiness documentation and local container validation are complete. Render is selected for the web service and Neon for PostgreSQL; no staging resources or production migration/publication have been created. Task 2.4 still lacks some feature-module adapters; Employees, Settings, Products, Inventory, Suppliers, Customers, Purchases, Purchase History, POS, Sales History, customer debt/payments, Expenses, Cash Accounts, confirmed transfers, daily reports and financial statements are adapted, while other feature screens remain gated where they call Tauri. Offline device enrollment and POS synchronization remain later work.
**Audited:** 2026-11-19  
**Desktop source:** `../inventory-app-kivu/`  
**Goal:** Build a separate, scalable Next.js web application that closely reproduces the existing desktop application's screens, workflows, business rules, and offline usability.

## 1. Scope and safety boundary

- The web application belongs in this sibling folder. Keep `inventory-app-kivu/` unchanged.
- Do not move, rename, reformat, or make "shared" edits in the desktop project. Do not change its Tauri commands, SQLite migrations, styling, or build configuration.
- Do not start implementation until the user has reviewed this guide and approved the next task.
- Build and validate the web app as small, complete vertical slices. Report changed files, behavior, checks, known gaps, and the next proposed task after each slice. Wait for approval before proceeding.
- The target is feature parity, not a generic inventory template. Match actual page structure, labels, fields, states, operation sequences, validation, permissions, and business-specific behavior.

## 2. Desktop audit — observed baseline

### Current implementation

The source is a Windows desktop application built with React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/Radix components, Lucide icons, React Router 7, Tauri 2, Rust, and SQLite (`rusqlite`). The source `package.json` has no Next.js, PWA, browser API backend, or web database dependency. The UI calls Rust through `@tauri-apps/api/core` `invoke(...)`; the frontend alone is not the application backend.

SQLite is initialized and migrated by Rust. The source includes 22 SQL migrations. Business logic, auth/session handling, permission checks, transactions, and persistence are implemented in the Rust/database layer and exposed through registered Tauri commands. The desktop database is local to the Windows application profile. The Tauri configuration points to a Vite development server and the built frontend assets; it does not host a remote Next.js application.

### Existing route and feature parity inventory

The route definitions and navigation in `src/app/routes/routes.tsx` and `src/app/routes/navigation.ts` show these currently implemented destinations:

| Area | Existing route | Observed responsibilities to preserve |
|---|---|---|
| Dashboard | `/` | Select business when applicable; show live inventory overview and stock alerts; link to a new sale. |
| Point of Sale | `/pos` | Search/paginate products; build a base-unit cart; select customer; split payment across cash accounts; support paid/credit sales; capture price-change reasons; validate quantities, stock and money; produce receipt. |
| Products | `/products` | Search/catalogue, product creation, category/brand/unit selection, product-specific selling units and price changes. |
| Inventory | `/inventory` | Stock levels, stock movements/history, opening stock, corrections, receiving stock and selling-price updates. |
| Purchases | `/purchases` | Supplier invoice creation, duplicate-invoice warning/confirmation, partial deliveries, explicit receipt, partial/full invoice payments, payment method and balance tracking. |
| Purchase history | `/purchase-history` | Review fully received/paid purchases, delivery detail, invoice lines and payments. |
| Sales history | `/sales` | Search/filter/paginate transactions and inspect saved sale lines and payment detail. |
| Customers | `/customers` | Customer records, editing and customer statement/credit information. |
| Suppliers | `/suppliers` | Supplier contact/address/tax details, editing and inactive status. |
| Expenses | `/expenses` | Record and list categorized, dated, described expenses and payment method. |
| Customer payments | `/payments` | Review customer debt and record debt repayments to an account. |
| Cash accounts | `/cash-accounts` | Manage cash/bank/mobile-money accounts, authorized opening balances, POS collections and confirmed transfers. |
| Reports | `/reports` | Daily financial/cash reconciliation and business performance; use the existing report calculations, not a new interpretation. |
| Income statement | `/reports/income` | Existing report view and calculations. |
| Balance sheet | `/reports/balance-sheet` | Existing date-based balance sheet. |
| Employees | `/employees` | Create/manage employees, password reset, active state and manager permissions. |
| Settings | `/settings` | Business setup, categories, brands, units and database backup/restore. |
| Daily report print | `/reports/daily/print` | Separate printable daily report route. |

These are observed routes, not a promise that every desired future function exists. Do not add fake features to achieve visual symmetry. The desktop README specifically calls out unsupported features and operational details; inspect it again before implementing any corresponding web workflow.

### Business and data constraints found in source

- Business records are scoped by `business_id`; users also have roles/permissions. A `branches` table and user branch field exist, but do not infer full multi-branch workflows from the schema alone.
- The permission-filtered navigation and route restriction behavior are part of the current UX and security expectations.
- Stored money is integer minor units at scale **100** (hundredths of RWF); quantities and unit conversion factors use integer scale **1000**. Timestamps are ISO-8601 UTC strings. Business configuration includes currency, timezone (default `Africa/Kigali`), date format and language.
- Sales may be paid, split-paid or on customer credit. Payments are separately recorded from sale totals. Customer debt repayments are distinct later cash movements.
- Purchases support partial delivery and payment. Inventory is increased only for explicitly received quantities; paying an invoice does not itself increase stock.
- FIFO cost layers are used for inventory valuation/COGS. Preserve actual receipt cost and historical sale/price information.
- Cash is ledger/account-backed. Confirmed transfers create linked out/in movements, are not expenses, and movements are immutable. Expenses, supplier payments, loan activity, customer receipts, sales collections and account transfers are distinct movement types.
- The UI uses Inter Variable, centralized CSS variables, a dark navy sidebar with a restrained warm accent, compact information-dense layouts, reusable form/table/dialog components, and tabular figures. `ui-guide.md` describes the intended visual quality; reproduce the running application’s actual screens and interactions rather than assuming that document alone is the final rendered reference.
- `reporting-guide.md` has explicit report definitions and exclusions; use it alongside the live Rust calculation code when reports are ported.

### Visual parity checkpoint — draft

The authenticated Tauri app has now been observed read-only at 1280x800. The notes below describe layouts, not business data; no screenshot files or customer/business records were copied into the guide.

| Route(s) | Reference observed | Remaining parity evidence before implementation |
|---|---|---|
| Sign-in / auth gate | Centered sign-in card; business selector, username/password, sign-in and recovery affordance. | First-run/owner bootstrap, recovery prompts, invalid credentials, network-required first sign-in and offline returning-user states. |
| `/` dashboard | Shared shell, summary cards, stock overview and quick actions. | Loading/error states, permission-restricted navigation, and additional representative data states. |
| `/pos` | Product search area beside cart, customer and payment/tender controls. | Valid cart, split/credit checkout, validation failures, price-change reason, receipt and offline-pending flow. Do not create a real sale to capture these. |
| `/products` | Product entry form and catalogue/search layout. | Lower-page catalogue/table, edit/price/unit dialogs and invalid/duplicate input feedback. |
| `/inventory` | Inventory summaries, searchable stock table and stock-management action. | Opening stock, receive/correction dialogs, movement history, validation/rejection and saved states. |
| `/purchases`, `/purchase-history` | Invoice page and separate completed-purchase history with search/date filters. | Supplier/invoice/line workflows, duplicate confirmation, partial delivery/payment, detail panels and validation; do not persist test purchases. |
| `/sales` | Search/date filters, summaries and transaction list. | Sale detail, pagination/filter changes and empty/loading/error variants. |
| `/customers`, `/suppliers` | Split create-form/directory layout; customer credit-limit field. | Existing-record edit, statements/details, inactive-state controls and invalid/duplicate input feedback. |
| `/expenses`, `/payments` | Transaction form alongside recent expense/debt ledger; repayment is attached to an existing debt. | Validation/low-balance rejection, confirmation and persisted receipt states; do not create real finance records. |
| `/cash-accounts` | Account setup/registered-account list with opening-balance and transfer sections. | Transfer initiation/confirmation, deactivation confirmation, validation and ledger detail; do not create/transfer funds. |
| `/reports`, `/reports/income`, `/reports/balance-sheet` | Daily date-filtered summary/print action and printable statement layouts. | Daily print route `/reports/daily/print`, print output, alternate date ranges and report discrepancy decision (see below). |
| `/employees` | Owner/Admin full-access description, Manager permission controls and manager creation form; no branch assignment UI. | Existing profile edit/reset/deactivate dialogs, restricted Manager view and server-side branch-specific access (new web requirement). Do not create a real account. |
| `/settings` | Business setup, backup/restore controls and start of the units section. | Below-fold units/categories/brands, safe download/upload behavior; do not run restore or change business configuration. |

This is not yet a complete approval matrix. Loading, error, validation, success, confirmation-dialog and mobile-width states remain unverified where observing them would require a persistent write, opening a system print/file dialog, or resizing/interfering with the user's desktop session. Build those parity cases later using synthetic web fixtures and non-destructive tests. No data export/import was run.

#### Reuse-first source map

The existing frontend is the required UI starting point. **Copy the relevant TSX/CSS into this new web app and adapt only what the platform boundary requires. Do not redesign or recreate these screens from scratch.** Keep the desktop originals unchanged; do not make the new app import files from outside its own folder at runtime.

| Existing source | Web migration action |
|---|---|
| `src/components/ui/` (15 UI components) and `src/components/shared/` (3 components) | Copy into the web app first. Keep component markup, variants, accessibility behavior and Tailwind classes. Resolve the matching dependencies/aliases in the new app rather than replacing these components. |
| `src/hooks/use-mobile.ts`, `src/lib/utils.ts` | Copy/reuse where compatible. The utility re-exports `cn` from the existing dependency; verify it and the class-variance/Radix imports in the new package. |
| `src/index.css` | Copy the desktop tokens, typography, base styles, report/print styles and Tailwind 4 imports into the web app, then make the smallest necessary Next.js/Tailwind adjustments. Preserve visual values; do not substitute a generic theme. |
| `src/modules/**` (23 module files) | Copy the actual page and section TSX. Preserve the JSX, component composition, fields, labels, validation, tables, dialogs, formatting and operation flow. Add Next.js client boundaries where hooks/browser APIs require them. Replace only the Tauri data-access calls with typed web service calls; isolate those changes so business/UI markup remains recognizable. |
| `src/app/routes/navigation.ts` | Reuse the navigation definitions and permission names. Adapt the link/rendering boundary to Next.js routing without changing groups, labels, icons or access rules. |
| `src/app/layouts/app-layout.tsx`, `app-sidebar.tsx`, `src/App.tsx`, `src/main.tsx`, `src/app/routes/routes.tsx` | Use as shell/routing references and copy reusable portions. Replace React Router's `Outlet`, `Link`, `useLocation` and Vite bootstrap with Next App Router layouts, `next/link`, `usePathname` and route entry files. Keep the existing layout/visual structure. |
| `src/app/providers/app-providers.tsx` | Reuse the tooltip provider; add only web-specific providers required by the approved API/offline architecture. |
| `src-tauri/src/db.rs`, `src-tauri/src/lib.rs`, `src-tauri/migrations/*.sql` | Treat as the authoritative business-rule, command-contract and schema sources. They are Rust/Tauri/rusqlite code and cannot be dropped into Next.js as-is. Map each command to a web service/repository and deliberately port/test its behavior against the approved PostgreSQL model. Never modify them for the web task. |
| `@tauri-apps/api/core` `invoke(...)` calls in feature modules | Replace at the data boundary with typed Next.js API clients/server actions that expose equivalent operations. Preserve loading, errors, permission outcomes and data shapes. Never ship a stub or success-shaped fallback. |
| `@tauri-apps/plugin-dialog` in `settings/business-setup-page.tsx` | Replace only the native file chooser/backup interaction with an approved browser upload/download or server-side export workflow. The SQLite backup/restore commands are not browser APIs. |
| `src/assets/`, `public/` | Audited assets are template-only: `src/assets/react.svg`, `public/vite.svg` and `public/tauri.svg`. Do not use these as Quincaillerie branding. The sidebar currently renders a “Q” mark; no business logo/image asset was found in these locations. Inter is imported from `@fontsource-variable/inter` in CSS/package dependencies, not stored in `src/assets/`; retain/bundle that font dependency for offline operation. |

#### Platform coupling to preserve carefully

The page modules are not presently data-layer independent: feature screens call Tauri `invoke(...)` directly, and auth is backed by the desktop session. This means we can reuse the page code and component hierarchy, but must replace those API boundaries; copying a page unchanged would still fail in a browser. The app shell also uses React Router and needs routing-only adaptation. `sidebar.tsx` is already a client component and uses browser cookie/window APIs for its local presentation state; check all other browser globals and add appropriate client boundaries to copied interactive components.

Use the existing UI as the visual baseline, then change source only in the new folder. Avoid broad find/replace of `invoke` calls: inspect each command's arguments, return contract, authorization and atomicity before wiring its web equivalent.

#### Frontend-to-backend command crosswalk

The following is the audited starting map from the UI's direct `invoke(...)` usage to registered Tauri commands. Treat it as a migration checklist; inspect each call site and handler in full when implementing that slice.

| UI source/module | Existing command family to preserve |
|---|---|
| `modules/auth/auth-gate.tsx` | `auth_business_status`, `auth_recovery_questions/prompts`, `auth_bootstrap_owner`, `auth_login`, `auth_recover_owner`, `auth_current_user/permissions`, `auth_logout`. |
| `modules/dashboard/dashboard-page.tsx` | `business_list`, `inventory_list`. |
| `modules/products/products-page.tsx` | `business_list`, `category_list`, `brand_list`, `unit_list`, `product_list`, `product_unit_list/create`, `product_create`, `product_selling_price_update`. |
| `modules/inventory/inventory-page.tsx` | `business_list`, `inventory_list`, `stock_movement_list`, `inventory_set_opening_stock`, `inventory_correct_stock`, `inventory_receive_stock`, `product_selling_price_update`. |
| `modules/pos/pos-page.tsx` | `business_list`, `customer_list`, `pos_product_search`, `pos_checkout`. |
| `modules/sales/sales-history-page.tsx` | `business_list`, `sales_history_list`. |
| `modules/purchases/purchases-page.tsx`, `purchase-history-page.tsx` | Supplier/product/account options, `purchase_list`, `purchase_create`, `purchase_record_payment`, `purchase_receive_delivery`, `purchase_history_list`. |
| `modules/customers/customers-page.tsx`, `payments/payments-page.tsx` | Customer list/create/update/statement, `customer_debt_list`, `customer_debt_record_payment`. |
| `modules/suppliers/suppliers-page.tsx` | Supplier list/create/update. |
| `modules/expenses/expenses-page.tsx` | `business_list`, `expense_list`, `expense_create`, cash-account payment options. |
| `modules/cash-accounts/cash-accounts-page.tsx`, `cash-account-payment-options.ts` | Account list/payment options/opening, transfer create/confirm/list, account create/active state. |
| `modules/employees/employees-page.tsx` | Employee list/create/password reset/active state and manager-permission list/update. |
| `modules/reports/*.tsx` | Daily range/report, `balance_sheet_report`, and print view. |
| `modules/settings/*.tsx` | Business create/list; category/brand/unit list/create; desktop-only `database_backup` and `database_restore`. |

Most commands are wrapped in `lib.rs` with `with_business_permission(...)`; some auth/setup commands use `with_public(...)`, and owner-only operations add role checks. Preserve the command-level permission contract on the server, not just the UI's permission-filtered navigation.

#### Backend source audit

- `src-tauri/src/main.rs` only enters `quincaillerie_manager_lib::run()`. `src-tauri/src/lib.rs` registers the Tauri plugins, opens the local `quincaillerie.db`, registers `DbState`, and exposes the `#[tauri::command]` adapter layer. It is not a web HTTP API.
- `src-tauri/src/db.rs` contains the SQLite domain/repository operations, validation, transaction boundaries, permission constants, data transfer structs, and Rust tests. Reuse its behavior and data contracts as the implementation specification; do not copy the command wrapper into a browser bundle.
- The migration registry in `db.rs` applies the 22 ordered `src-tauri/migrations/001_...sql` through `022_...sql` migrations. It runs pending migrations in transactions and includes coverage for fresh-database setup and idempotence. Port them deliberately to PostgreSQL; SQLite SQL syntax, triggers, integer rules and migration backfills need review rather than blind execution.
- `DbState` owns one `Mutex<Connection>` plus an in-memory optional desktop session. The web app instead needs a pooled server-side database connection and secure web sessions. Never recreate the desktop global connection/session in browser state.
- The command wrappers enforce authentication, active-session/business membership and permissions such as `catalog.read/manage`, `inventory.read/manage`, `pos.use`, `sales.manage/read`, `purchases.manage/read`, `expenses.manage/read`, `cash_accounts.manage`, `reports.read`, customer and employee permissions. Web routes and API calls must apply equivalent checks on every request.
- High-risk atomic workflows to map and test from `db.rs`: POS checkout (stock decrement, FIFO layer consumption, sale lines, credit and payment/cash-ledger records); purchase delivery (partial quantities, receipt rows, stock/cost layer and invoice status); supplier/customer/expense payments; account transfer confirmation (paired immutable ledger movements); inventory corrections/receiving; and audit events.
- POS rejects inactive/cross-business products, invalid scaled quantities, insufficient stock, overpayments, invalid tender accounts and over-limit customer credit; price changes and below-FIFO-cost sales require a reason. Purchases do not add stock until a delivery is explicitly received. Expense/payment/transfer writes require valid opened account balances. These are server invariants, not frontend-only validation.
- `database_backup`/`database_restore` are owner-only local filesystem operations: backup checkpoints/copies a SQLite file and restore validates SQLite integrity, replaces the local file and exits the desktop app. These commands have no direct web equivalent. Use approved server/database backup and restore processes instead; don't expose arbitrary server paths or provide a web restore that silently replaces production data.
- Rust tests in `db.rs` cover permission, validation, atomicity/reconciliation, FIFO valuation, checkout stock/payment failures, partial receipt and migration behavior. Add corresponding web unit/integration tests; do not alter or run-build the desktop project as part of this migration.

#### Work status — 2026-11-17

- **Gate 0:** Complete based on the user's answers recorded above.
- **Phase 1 source audit:** Route map, navigation/permissions, app shell, authentication, all feature-module Tauri call sites, registered Rust command adapters, session/permission boundary, key transactional operations, migration registry, cash ledger, sales/purchases/expenses schema, and report calculations have been inspected.
- **Visual reference capture:** The running Tauri login, dashboard, Employees, POS, Products, Inventory, Purchases, Purchase History, Sales History, Customers, Suppliers, Expenses, Customer Payments, Cash Accounts, daily Reports, Income Statement, Balance Sheet and Settings screens have been observed at 1280x800. Login: pale gray background and centered white card with business selector, username/password, navy sign-in button and owner-password recovery action. Shared shell: dark navy grouped sidebar with Q mark, white workspace header and administrator/sign-out controls, pale gray content canvas. Dashboard: summary cards, stock overview and quick actions. Employees: Owner/Admin full-access description, granular Manager permissions, create-manager form and retained inactive-profile model; no branch assignment UI. POS: product search/cards and cart/customer/split-payment panel. Products: two-column product form. Inventory: summary cards, searchable stock table and stock-management action. Purchases: invoice entry/empty state separated from purchase history; stock is received in a separate step. Sales/Purchase History: date range/search, summary cards and transaction tables. Customers/Suppliers: split create form and directory panels; customer form includes credit limit. Expenses/Payments: left-side transaction form and right-side ledger/list, with repayment tied to an existing customer debt. Cash Accounts: account setup and registered account balances, with owner/admin-controlled opening amounts. Reports and statements: date filters, printable summaries/tables. Modal/validation/success states and mobile widths remain pending. Screens were inspected in place only; no business/customer data has been copied into this guide. Do not capture or record credentials or business/customer data.
- **Implementation:** Tasks 2.1-2.3 are complete. Forty-eight UI/source files and the desktop stylesheet were initially copied and hash-verified. Next-specific routing/link/client-boundary adaptations are in the web copies; the original React Router entry was replaced by the Next route map. Eighteen known routes resolve, unknown routes return 404, Employees is now adapted to the Admin APIs, and other feature routes remain explicitly gated after authentication. The route-level parity checkpoint remains a draft. The only source asset is an unused Vite `react.svg`, so it was not copied.
- **Task 2.2 validation (before activating desktop CSS):** Production build and typecheck passed; `npm test` passed with no tests defined; `npm audit` had no findings. The full lint run reported 29 issues in copied desktop source (28 `react-hooks/set-state-in-effect`, one `react-hooks/purity`); the active scaffold/config files linted cleanly.
- **Task 2.3 validation:** Production build and typecheck pass; all 18 known routes and the 404 boundary were verified against the production server; `npm test` passes with no tests defined; `npx eslint src/app` passes. Full `npm run lint` still reports the 29 copied-source issues. `npm audit --omit=dev` reports no vulnerabilities; full `npm audit` reports four moderate transitive findings in the `shadcn` development dependency (`minimatch`, GHSA-g3hv-75wg-m249).
- **Task 2.4/3.3 auth validation:** The same-origin auth client is connected to database-backed handlers. Typecheck, production build, targeted ESLint, 8 unit tests and 3 PostgreSQL integration tests pass. The auth flow is active; other feature-module APIs and the native settings dialog remain unadapted.
- **Task 2.5/3.2/3.3 container validation:** A fresh PostgreSQL database applied migrations `0001` and `0002` through the checksum-tracked migration runner. Repository and auth-flow integration tests passed against PostgreSQL. The health check probes TCP readiness so it cannot accept PostgreSQL's temporary initialization server.
- **Task 6.1 validation:** PostgreSQL integration tests cover branch activation without a Manager, last-Manager deactivation protection, multi-Manager branches, reassignment, session revocation, Manager password reset, permission updates, Admin-only APIs, same-origin checks, and concurrent Manager deactivation. Targeted typecheck and ESLint pass.
- **Task 6.1 Docker validation:** The Alpine production image built successfully, started, returned HTTP 200 from `/api/health`, and loaded the Argon2 native module. `npm audit --omit=dev` reports zero production vulnerabilities. The image's full `npm ci` audit reported 20 vulnerabilities in the complete dependency tree (2 moderate, 18 high); the follow-up full `npm audit` did not return within the validation window, so review the development dependency findings before relying on the full audit status.

#### Reporting discrepancy requiring owner decision

The current daily report API (`daily_business_report`) calculates `total_inflow` from completed **sales totals**, including credit sales, and computes `net_position = sales_total - expenses_total`. It also computes `money_received` separately from non-transfer cash-ledger inflows and exposes payment-method breakdowns. The Reports UI describes the summary net position as “Money received minus expenses,” while the summary value is based on sale totals. This does not match the requirements in `reporting-guide.md`, which distinguish actual money received from sales value/credit sales.

Do not silently “fix” or reproduce this ambiguity in the web implementation. Before implementing or migrating reports, ask the user to choose whether the web report should:

1. Match the current Rust/UI calculation exactly (including its current labels and behavior); or
2. Follow `reporting-guide.md` so net position uses actual money received, with credit sales shown separately.

Record the decision and add regression tests around credit sales, split payments, customer repayments, expenses and transfers. Do not modify the desktop report as part of this web task.

## 3. Architecture decision — approval required

There are two distinct requirements in the request:

1. A web app/PWA that can be hosted and used in a browser.
2. "Make sure Tauri is used."

Tauri is a native desktop runtime, not a web server or PWA backend. A browser PWA does not run inside Tauri. The recommended default is:

- Keep the existing desktop app and its Tauri use untouched.
- Build the new deployable app as a **Next.js full-stack web application and installable PWA**.
- If a new native installer using the new UI is also required, treat that as a separately approved deployment target and design a Tauri wrapper only after the web app/server/static-hosting constraints are decided. Do not make the Next.js web app depend on Tauri APIs.

**Gate 0:** Before application implementation, ask the user to confirm this interpretation or choose a separate Tauri-wrapped desktop deliverable. Also confirm which transactional workflows must remain usable with no network. Do not silently resolve either decision in code.

### Gate 0 decisions recorded

The user approved the following on 2026-11-17:

- **Delivery:** Hosted Next.js PWA only. Keep the existing Tauri desktop untouched; do not make a new Tauri package.
- **Offline identity:** First sign-in/device enrollment must be online against the hosted database. Afterward, only a previously signed-in user on an approved device may use approved offline functionality; require periodic online re-authentication.
- **Offline writes:** POS is the initial offline write workflow, alongside appropriately labeled cached reads. Keep purchases, receiving, inventory corrections, expenses, customer repayments, supplier payments, transfers and other cash-management writes online-only initially. POS behavior remains pending sync until server confirmation.
- **Conflict handling:** Queue and mark offline operations pending; surface stock/cash conflicts for manager review. Never silently present queued work as server-confirmed.
- **Database migration:** Start the web dataset fresh; do not import desktop SQLite business records.
- **Hosting provider:** Render is selected for the Docker-based web service and Neon for hosted PostgreSQL. Use local Docker Compose/PostgreSQL for development. The user selected free-tier plans; staging resource creation remains pending.

The user delegated selection of offline workflows to the implementation. POS is selected as the most valuable first offline write path, but its detailed tender rules, cache freshness, local provisional stock handling and reconciliation behavior must be specified and tested before Phase 4 is implemented.

### Additional user requirements — organization and roles

The user clarified that the web app must support:

- **Admin:** business-wide authority across all branches; can create/manage managers and control branch access.
- **Manager:** limited to the assigned branch and to permissions the Admin allows.
- **Branch coverage:** every active branch needs at least one active Manager assigned; more than one Manager may cover a branch. Each Manager account is assigned to one branch only.
- **First login:** requires internet access to authenticate and load the hosted database. Offline use is only for a previously authenticated/enrolled device and is subject to the approved offline policy.

The desktop calls its top role `owner` (the signed-in shell currently displays “Administrator”) and already has Manager permission management. Its schema has `branches` and `users.branch_id`, but the inspected route map has no branch-management UI and the current `with_business_permission` guard scopes by business, not branch. Therefore branch assignment, per-branch authorization on every read/write, and the required-manager invariant are additional web requirements—not features to fake by merely copying the employee screen. Map the existing role/permission behavior, then implement the approved branch scope in the web backend and UI.

## 4. Recommended technical direction (confirm versions at implementation time)

- **Web application:** Next.js App Router, TypeScript, Tailwind CSS, server-rendered shell with client components only where interaction/offline state requires them.
- **Web backend:** Next.js route handlers and server-only application services/repositories. Use server-side authorization on every protected operation; client-side navigation filtering is not security.
- **Central data store:** PostgreSQL for hosted multi-user operation. Use a typed SQL-first ORM such as Drizzle (or another choice only if the user approves) with checked-in migrations. Port the current SQLite schema and transaction rules deliberately; do not point a public web server at the desktop SQLite file or expose direct database credentials to the browser.
- **Offline client data:** IndexedDB via Dexie for explicitly approved local read models and a durable write outbox. Cache the app shell/static assets with a maintained service-worker implementation compatible with the selected Next.js version (verify current Serwist support before choosing it). Do not rely on an obsolete PWA plugin.
- **Validation and UI state:** Shared Zod request/domain schemas, React Hook Form for complex forms, TanStack Query for online request/cache coordination, and TanStack Table where it fits the existing table interactions. Preserve exact currency/quantity precision with integer-scaled values or an explicitly safe decimal type; never use floating-point arithmetic for ledger totals.
- **Authentication:** Server-managed, secure, HttpOnly, SameSite cookies; enforce business scope and permission checks on the server. Re-design the Tauri in-memory desktop session for web safely; do not copy local session assumptions, expose password hashes, store long-lived auth tokens in localStorage, or put secrets in client bundles.
- **Offline write/sync model:** Use client-generated stable operation IDs, idempotent server processing, durable queued operations, visible pending/synced/failed states, retry/backoff, and explicit conflict handling. A local service worker cannot make a server/database reachable without a connection. Confirm which actions are allowed offline and what happens when two devices change the same stock/cash balance. Do not tell users a transaction is synced until the server confirms it.
- **Containers:** Docker Compose for local web + PostgreSQL development with a persistent database volume, health checks and migrations. Provide a production-ready Next.js Docker image and deployment instructions. Keep secrets in environment configuration, commit only `.env.example`, and document backup/restore and migration procedures.
- **Testing:** Unit tests for money, quantity, permissions, business services and sync/idempotency; PostgreSQL integration tests for transaction invariants; Playwright tests for UI workflows, install/offline behavior and desktop-vs-web parity where both are available.

This is a recommendation, not authorization to migrate data, deploy services, or change the desktop application. Database provider, hosting, identity policy and offline conflict rules are approval gates.

### Where web code will live

Use the existing feature/module boundaries where practical, inside the new folder only:

```text
web application/
  src/
    app/
      (workspace)/             # Next route wrappers/layouts; preserve the source shell
      api/                     # Next.js HTTP route handlers
      globals.css              # adapted copy of the desktop src/index.css
    components/
      ui/                      # copied existing UI primitives
      shared/                  # copied existing shared components
    modules/                   # copied existing module TSX; wire per approved slice
    lib/
      api/                     # typed browser API client
      offline/                 # approved IndexedDB/outbox client
      validation/              # shared client-safe schemas/helpers
    lib/server/
      auth/                    # server-only sessions and authorization
      db/                      # PostgreSQL connection and transaction helpers
      repositories/            # server-only data access
      services/                # business operations ported from db.rs
  db/migrations/               # PostgreSQL migrations, independent of desktop SQL
  public/                      # approved PWA manifest/icons and verified assets
```

`src/app/(workspace)` is a Next.js route group, not a copy of the desktop React Router tree. Each `page.tsx` should render the copied module screen. Keep server-only database/auth code out of client components. For each feature slice, first reuse the matching module TSX, then add its server service/repository and route handler, and finally replace only that module's Tauri call sites with typed API calls. Do not create placeholder services that report success or bundle Rust/Tauri APIs into the browser.

## 5. Approval-gated implementation plan

Each numbered task is a separate checkpoint. At the end of one task: summarize the evidence, code/files changed, test results, outstanding decisions and the exact next task; then stop for user approval. Do not implement multiple later tasks just because they are listed here.

### Phase 0 — Confirm the product boundary and offline policy

**Task 0.1 — Done:** User chose the hosted Next.js PWA only; existing Tauri desktop remains untouched, with no second Tauri wrapper.  
**Task 0.2 — Baseline decided:** User approved online first sign-in/device enrollment, prior sign-in on an approved device for offline use, POS as the initial offline write path, and manager review for sync conflicts. Detailed offline POS tender/stock reconciliation rules remain a Phase 4 prerequisite.  
**Task 0.3 — Decided:** User chose a fresh web dataset with no SQLite import, Render for the Docker-based web service, and Neon for hosted PostgreSQL. Use local Docker Compose/PostgreSQL for development. The user selected free-tier plans; staging resources have not been created.

**Gate status:** Product boundary, initial offline policy, branch-manager cardinality, and hosting providers are recorded. Do not provision staging resources, incur hosting costs, migrate production data, or publish without explicit approval.

### Phase 1 — Screen-by-screen parity audit and reference capture

**Task 1.1:** Start the existing desktop safely; capture a reference for each route at normal, loading, empty, validation-error, restricted and success states that the current app actually supports.  
**Task 1.2:** Trace every UI action to its Tauri command and Rust database function. Read all applicable SQL migrations, not only table names.  
**Task 1.3:** Build a parity matrix of page layout, labels, fields, sorting/filtering, dialogs, keyboard behavior, permission, error, success and persistence behavior. Record missing/unsupported desktop features.

**Done when:** The user approves the baseline matrix and visual reference. No feature or state is represented by fabricated data.

### Phase 2 — Web/PWA architecture and delivery skeleton

**Task 2.1 — Done:** Created the Next.js App Router/TypeScript foundation directly in `web application/`, added lint/typecheck/test scripts, documented the desktop boundary, and pinned Turbopack to this app root. `npm run lint`, `npm run typecheck`, `npm test` (no tests exist yet), and `npm run build` pass. No desktop UI or product behavior has been copied or implemented.  
**Task 2.2 — Done:** Copied the source UI/shared components, feature modules, hooks, utility, shell/layout/provider files, route map/navigation and stylesheet into the new app. The copies are byte-identical to the desktop originals; none are imported from the desktop folder at runtime. Preserve TSX/markup and styling first; do not create replacement screens.  
**Task 2.3 — Done:** Added client boundaries to copied interactive modules; adapted the shell/sidebar and feature-link navigation to Next.js; activated the copied desktop CSS and local Inter font; replaced the React Router route entry with a route map and explicit App Router pages for all 18 desktop paths. Per the user's choice, each page is gated; no fake account or data is rendered.  
**Task 2.4 — In progress (auth boundary complete):** Replaced the copied auth gate's Tauri dependency with a typed same-origin HTTP client. Task 3.3 implemented its auth handlers. Feature-module service adapters and the desktop-only settings file workflow remain unimplemented; feature routes stay gated. The user chose Business-Admin password resets for Managers; implementing that Manager-management action remains in the branch/employee slice.
**Task 2.5 — Done:** Added a standalone production Dockerfile, local PostgreSQL Compose service with persistent volume and health check, one-shot SQL migration runner, web health endpoint, `.env.example`, and container instructions. The runner records applied migration checksums and fails on changed migrations. The current auth migrations are applied by the same runner.
**Task 2.6:** Add installable PWA shell, manifest, icons and offline fallback; verify service-worker caching rules and HTTPS requirements.

**Done when:** A clean clone can start through documented commands; health checks pass; production build succeeds; shell installs and loads offline without exposing/caching private server responses.

### Phase 3 — Data model, migration and secure backend foundation

**Task 3.1 — Done:** Audited all 22 SQLite migrations and the Rust auth/business/permission/branch flows; mapped their migration themes and implemented the PostgreSQL identity/auth foundation. Feature schemas and all data imports remain out of scope.  
**Task 3.2 — Done (identity foundation slice):** Added server-only PostgreSQL pool/transaction utilities, parameterized business/branch/user/session/Manager-permission repositories, and Zod schemas for auth, branch and Manager-permission inputs. Feature-specific repositories and multi-table workflows are deferred until their feature schemas are approved; each must use the shared transaction utility and preserve the atomicity rules below.  
**Task 3.3 — Complete (auth foundation):** Added online Admin bootstrap, email verification/resend, Admin/Manager sign-in, server sessions, logout, Admin email password reset, PostgreSQL-backed rate limits, auth audit records, same-origin POST checks, no-store responses, secure cookies/errors, and reusable business/branch/permission guards. Desktop Argon2id defaults and Admin/Manager role semantics are preserved. Admin bootstrap creates no session; email verification is an explicit POST action and sign-in is a separate online step. Integration tests exercise Admin and Manager sessions, permission denial, branch isolation, rate limits, email token lifecycle, session revocation and route cookie/CSRF behavior. The transaction-safe `assertActiveBranchManagerCoverage(executor, businessId)` guard is used by Task 6.1 mutations. Sign-in also serializes against business/branch changes and rechecks the password hash to prevent stale-password login races. Device enrollment and offline auth remain Phase 4 work.

**Task 3.4:** Produce a reviewed SQLite-to-PostgreSQL import/rollback plan and reconciliation report. Do not run imports against real data without explicit approval and a verified backup.

**Done when:** Automated integration tests prove transaction and authorization invariants for the implemented slice; feature transaction, idempotency and numeric-precision tests are added with each later feature; migration/import remains opt-in.

### Phase 4 — Offline data and synchronization foundation

**Task 4.1:** Implement the approved offline cache and versioned IndexedDB schema; decide which data is safe and necessary to cache on a shared device.  
**Task 4.2:** Implement the durable operation outbox, idempotent sync, retry, server acknowledgments and user-visible pending/error/retry states.  
**Task 4.3:** Implement the approved offline permission/session expiration and conflict-resolution paths. Protect against duplicate checkout, stale product prices, stale inventory, unauthorized replay and partial transactions.  
**Task 4.4:** Test airplane-mode restart, browser refresh/close, reconnect, failed sync, duplicate retry and concurrent stock changes.

**Done when:** Each offline behavior is covered by deterministic tests and is clearly labeled to the user. Offline guarantees must match the policy approved in Phase 0.

### Phase 5 — Design-accurate app shell and authentication

**Task 5.1:** Reproduce the desktop's sidebar grouping, logo/identity, active/disabled navigation, workspace header, user controls, content widths and scroll behavior. Adapt responsively without changing the product's information hierarchy.  
**Task 5.2:** Reproduce initial owner/business setup, sign-in, recovery and logout using the approved secure web identity model.  
**Task 5.3:** Match all permission-filtered navigation and restricted-route behavior, with server enforcement as well.

**Done when:** The shell and auth screenshots/flows are compared to the approved desktop reference at desktop and mobile widths; no protected API depends on the client check alone.

### Phase 6 — Feature parity, one approved vertical slice at a time

Implement and approve one task at a time. Each task includes UI, API/service behavior, persistence, offline status where approved, permissions, errors, tests and a parity comparison. Suggested order:

1. **Task 6.1 — Done:** Admin business name/tax ID, branch create/edit/activation, Manager create/reassign/activate/deactivate/password reset, and Manager permissions are connected to PostgreSQL services and same-origin APIs. Branches are created inactive and can be activated only when a Manager is active. Every branch/Manager mutation is serialized on the business row and checks active-branch coverage before commit; affected sessions are revoked when a branch is deactivated, a Manager is deactivated/reassigned, or a password is reset. Employees now renders the web-adapted administration screen; Manager access is denied server-side.
2. **Task 6.2 — Done:** Web-adapt the Settings screen for the signed-in business; business details; categories/subcategories; brands; system and business units. PostgreSQL integration tests, typecheck, targeted lint, unit tests and production build passed. Admin and Manager authenticated browser views were checked; the authenticated shell renders correctly. A restored-session logout bug that briefly showed Admin setup instead of existing-business sign-in was fixed and verified.
3. **Task 6.3 — Done:** Product catalogue and product-specific selling units/prices are implemented as a business-scoped PostgreSQL vertical slice. Admin and Manager browser views were checked; the read-only Manager view hides mutation controls.
4. **Done:** Inventory, opening stock, corrections, receiving and stock movement history.
5. **Done:** Suppliers and customers directories, exact credit limits, permissions, tenant scope, audit records and browser-adapted desktop UI. Customer statements/outstanding balances remain deferred to sales and customer-debt workflows.
6. **Done:** Purchase invoices, duplicate confirmation, partial/full delivery and branch inventory/FIFO posting. Supplier payments remain separate from delivery/stock receipt.
7. **Done:** POS, branch stock search, cart validation, split payment methods, customer credit, authorized price changes/below-cost reasons, FIFO consumption and receipt output. Cash-account balances remain deferred to the approved ledger slice.
8. **Done:** Sales history, branch scope, transaction/customer/product/SKU search, date filters, pagination, totals and transaction/detail snapshots.
9. **Done:** Customer debt/payments and statements, sale-payment and later-repayment reconciliation, overpayment protection and audit records.
10. **Done:** Expenses and cash-account ledger—account creation/opening, verified balances, matched accounts and account-backed expense movements.
11. **Done:** Cash-account openings, transfer initiation/confirmation and account balance. Pending transfers preserve balances; confirmation posts mirrored source/destination movements.
12. **Done:** Manager profile details, full-name editing, password reset, branch reassignment, active status and Manager permission controls.
13. **Done:** Dashboard with branch-scoped FIFO inventory value, active products, low/out-of-stock counts, stock preview, alerts and quick actions.
14. **Done:** Daily report and print, with branch/date sales, expense, purchase, customer-debt and physical-cash reconciliation totals.
15. **Task 6.15 — Done:** Income statement and balance sheet, with COGS, historical inventory, receivables, supplier payable movements, retained earnings, branch/date selection, and explicit accounting limitations.
16. **Task 6.16 — Done:** Admin-only streaming business data export. The versioned JSON contains business-scoped operational, catalog, user-metadata and audit records; it excludes password hashes, sessions, authentication tokens and rate-limit state. No restore is offered because a browser upload must not replace or cross tenant boundaries in the hosted PostgreSQL database. Full database backups/restores remain deployment-operator work.
17. **Task 6.17 — Done:** Supplier invoice payments use opened, method-matched cash accounts, branch scope, sufficient-funds checks, an atomic purchase-payment/cash-movement/audit transaction, and completed Purchase History filters/details. Supplier payment records are included in the business-scoped Admin export. Payments remain online-only.
18. **Task 6.18 — Done:** POS payments select active, opened, method-matched branch accounts and atomically post sale-payment records with incoming cash-ledger movements. A single eligible account is selected automatically; when several match, the cashier chooses the destination. Existing payments are backfilled only when one eligible account can be identified safely; ambiguous historical payments remain unassigned.
19. **Task 6.19 — Done:** Customer debt starts at the amount still due after checkout payments, historical overstatements are reduced by migration `0014_customer_debt_balance.sql`, and repayments are limited to the remaining balance. Balance-sheet receivables are derived from customer debt records and cannot become negative from legacy overpayments.

This ordering is a proposal, not a claim that one module is independent of another. Reorder when dependencies or user priorities require it. Preserve all known limitations from the desktop README; implement a new feature only after explicit scope approval.

**Done when (per slice):** The parity checklist passes; tests cover both expected and rejection paths; no data is hardcoded; the user approves before the next slice.

### Phase 7 — Quality, offline, security and visual parity audit

**Task 7.1:** Run the full typecheck, lint, unit, integration, production build and Playwright suites.  
**Task 7.2:** Compare each web route against the approved desktop reference using the same representative test fixtures; document intentional responsive differences.  
**Task 7.3:** Verify PWA install/update/offline/reconnect, sensitive-cache exclusions, keyboard/accessibility behavior and supported browser behavior.  
**Task 7.4:** Review authorization, tenant isolation, validation, secure headers, CSRF/session configuration, dependency advisories and production error handling.  
**Task 7.5:** Reconcile representative sales, inventory/cost layers, customer debts, purchase payments, cash accounts/transfers and reports between source behavior and web results.

**Done when:** Critical workflows are verified end to end; all mismatches and limitations are reported; no unexplained test failures are hidden or waived.

### Phase 8 — Deployment readiness (separate approval)

Use a Render Docker Web Service with Neon PostgreSQL for staging. Configure HTTPS, environment variables, database migrations, backups, restore drills, monitoring, retention and rollback, then validate the deployment before production. The user selected free-tier plans, but staging resources have not been created; do not upgrade plans or incur charges without explicit user approval. Do not publish or migrate production data without explicit approval.

The selected initial configuration is the Render free web-service plan and Neon free plan. `render.yaml` defines the Docker service in Ohio to match the Neon project region and deploys on each commit to the branch selected when creating the Blueprint. `DATABASE_URL`, `WEB_BASE_URL`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL` are entered as unsynchronized environment values rather than committed. The Docker image applies pending migrations before launching Next.js, including on Render's free plan, which does not support pre-deploy commands; the runner uses a PostgreSQL advisory lock and checksum tracking. Use the Neon pooled SSL connection string and set `WEB_BASE_URL` to the exact deployed HTTPS origin. Free services can sleep and cold-start, so this is for staging/evaluation, not production reliability. No external resources have been created.

For the temporary no-email first-Admin recovery, set a randomly generated `ADMIN_BOOTSTRAP_SECRET` of at least 32 characters in Render, use it only to verify the existing pending Admin, then remove it from Render. The code verifies the secret in constant time, rate-limits attempts, consumes outstanding email-verification tokens, and audits the verification. This does not disable email verification for other flows; configure Resend before relying on verification or recovery emails for future accounts.

## 6. Non-negotiable business and safety rules

1. Inspect the current implementation before changing a workflow; existing behavior and migrations are the source of truth unless the user approves a business-rule change.
2. Never change the existing desktop tree. Work only in `web application/` unless the user separately changes scope.
3. Do not count a sale's sale total and its payment rows as two separate money receipts. A credit sale is not cash collected; later debt repayment is a separate receipt.
4. Do not treat supplier payments or account transfers as operating expenses. Do not count both legs of a transfer as new business income.
5. A purchase payment does not receive stock. Only an explicit receipt of delivered quantities updates inventory.
6. Preserve FIFO cost layers, historical sale line values, overrides/reasons, immutable ledger operations and auditability.
7. Keep all persisted money/quantity operations exact and scaled; reject invalid or out-of-range values explicitly.
8. Keep every write scoped to an authorized business and permission; never trust a `business_id`, role or permission supplied only by the browser.
9. Do not make a UI say "complete" when a write is only queued locally. Show queued, synced, rejected and conflict states accurately.
10. Avoid inventing branches, reports, payment methods, permissions, returns, print behavior, or features absent from the source. Ask or document gaps.
11. Never copy production records, credentials, database files or secrets into the new app, repository, prompts, screenshots or test fixtures.
12. Keep generated and local database data out of source control; use non-sensitive synthetic fixtures for tests.

## 7. Reusable master implementation prompt

Use the following prompt for each approved task. Replace the bracketed fields; do not broaden the task.

> You are implementing the approved task **[TASK ID AND NAME]** for the separate Quincaillerie Manager web/PWA in `web application/`.
>
> **Before editing:** Read this guide and the relevant source files in `../inventory-app-kivu/`. Trace the exact desktop UI behavior, Tauri command, Rust implementation, migrations, data shapes and permission checks. If those sources do not settle an important decision, stop and ask rather than inventing behavior.
>
> **Scope:** Implement only [APPROVED TASK SCOPE]. Preserve the desktop repository completely unchanged. Work inside the new web application folder. Do not replace real behavior with generic mock screens or fabricated production data.
>
> **Reuse-first requirement:** Copy the relevant existing TSX, shared/UI components, CSS, utilities and navigation from `../inventory-app-kivu/src/` into this app. Start from those files; do not draw a new screen or create replacement components where the source already has one. Make changes only to the new copies, and keep each change to the minimum needed for Next.js routing, browser APIs or the web service boundary. Never import the desktop folder at runtime.
>
> **Parity requirement:** Preserve the actual source JSX and reproduce the approved desktop screen/workflow faithfully: content hierarchy, labels, table columns, forms, validation, dialogs, loading/empty/error/success states, keyboard behavior, permissions and persisted outcomes. Replace Tauri calls with equivalent typed web services without redesigning the screen. Responsive adaptations may change layout only where the approved reference requires it.
>
> **Architecture:** Use the approved Next.js App Router, TypeScript, Tailwind, PostgreSQL and server-side service/repository approach. Validate inputs on the server, authorize every operation on the server, scope every operation by business and (for Managers) their single assigned branch, preserve exact integer-scaled money and quantities, and keep multi-record business writes atomic. First sign-in/device enrollment is online; follow the remaining offline policy approved in Gate 0, queue writes durably and idempotently, and distinguish pending from server-confirmed results.
>
> **Quality:** First inspect; then implement the smallest complete vertical slice. Add only focused tests that fail without the behavior and cover important rejection/edge cases. Run the narrowest relevant tests, typecheck/lint and build as appropriate. Do not suppress failures or silently fall back to success-shaped data.
>
> **Stop condition:** Do not start a later phase or task. At completion report (1) source behavior traced, (2) changed files, (3) user-visible result, (4) tests and exact results, (5) parity/offline/security risks or open questions, and (6) the next task proposed. Stop and wait for user approval.

## 8. Per-task completion checklist

- [ ] The user approved this task and scope before implementation.
- [ ] Desktop screen, command, Rust implementation, migrations and related documentation were inspected.
- [ ] Existing TSX and assets were copied/reused; new screens were not recreated from scratch.
- [ ] Any changed JSX/style or Tauri/API boundary is limited to the new app and recorded for review.
- [ ] Web behavior matches the observed source; differences are approved and documented.
- [ ] Business rules, tenant scoping, permissions, exact precision and atomicity are preserved.
- [ ] Offline behavior follows the explicit policy and reports sync status honestly.
- [ ] Loading, empty, validation, authorization, server-error, pending and success states are handled.
- [ ] Focused tests cover the task and important failure cases; relevant typecheck/lint/build checks pass.
- [ ] No changes were made to `inventory-app-kivu/`; no secrets or real customer/business data were added.
- [ ] The user received the results and approved before work proceeds.

## 9. Current checkpoint: Task 6.19 balance-sheet receivables

Tasks 2.5, 3.1-3.3 and 6.1-6.19 implementation and automated validation are complete. Task 6.19 corrects the root cause of negative receivables: new POS debts store the amount due after sale-time collections, repayment processing derives the effective balance after sale payments, and the customer-debt view never reports a negative amount due. Migration `0014_customer_debt_balance.sql` reduces legacy debt amounts that exceeded the remaining amount at checkout without deleting payment history. The balance sheet now derives receivables from customer debt records and treats historical overpayments as zero receivable rather than failing with HTTP 500. POS, customer-debt, and financial-statement integration tests cover partial checkout payment, legacy debt overstatement and overpayment. The migration was applied to the local development database and corrected two overstated debt rows. All 17 PostgreSQL integration tests passed; TypeScript and targeted ESLint passed. A live repository calculation confirmed the current balance sheet completes with nonnegative receivables. The local dev server remains available on port 3013.

Phase 7.2 visual review is in progress. A route sweep found Next.js instant-navigation errors on Products, Inventory, Purchase History, and Employees; adding the existing `export const instant = false` route setting resolved them, and all four routes render while signed in. The Dashboard review aligned number styling, FIFO-cost copy, the low-stock badge treatment, and stock-alert wording with the desktop source. The Admin branch selector and branch-scoped product counts are intentional web adaptations. Purchase History is now connected and its authenticated empty state was browser-checked; its populated details and payment transactions were verified with synthetic PostgreSQL integration fixtures rather than live business writes. Remaining responsive/device-width and route-by-route visual comparisons are not yet complete.

The user approved per-branch stock: Admins select a branch, and Managers are restricted to their assigned branch. The inventory UI is adapted from the copied desktop screen. Migration `0005_branch_inventory.sql` adds branch balances, movement history, and FIFO cost layers, using thousandths for quantities and hundredths of RWF for money. Opening stock is allowed once per product per branch; corrections require a reason and consume FIFO layers for reductions; receipts add cost layers and may update selling price; inventory history is branch-scoped. The business-wide product selling-price floor is the highest remaining unit cost across all branches, falling back to product purchase price when no layers remain. Writes use transactions, branch/user scope locks, and audit records. The integration test covers Admin/Manager branch scope, permissions, opening stock, correction, receipt rollback and success, FIFO valuation, price floors, and movement audit.

The identity/auth foundation, Settings catalog, product/unit/price-history, inventory, supplier/customer, purchase, POS/sales, debt, ledger, and transfer schemas are in migrations `0001`-`0014`; no desktop data is imported. Supplier/customer credit limits use hundredths of RWF; purchase and sale quantities use thousandths and costs use hundredths. Server-only repositories use parameterized SQL and multi-write operations use the shared transaction utility. Initial business creation remains in Admin bootstrap; the Settings slice does not create additional businesses. Native SQLite backup/restore remains unsupported. Admins have business-wide scope and no branch; each Manager has one assigned branch, while multiple Managers may share it. The database enforces role/branch shape and tenant-safe foreign keys. Task 6.1 serializes all branch/Manager mutations on the business row and runs the Manager-coverage guard before commit; new branches start inactive.

The income statement uses completed sales and persisted sale-item cost snapshots for revenue and COGS, plus expenses in the selected date range. The balance sheet calculates cash and bank movements, historical inventory by reversing later stock movements, receivables from each debt's checkout balance less later repayments, and purchase payables net of linked supplier-payment movements. Legacy repayment overages cannot create negative receivables. POS sale collections, supplier payments, expenses, repayments and transfers are represented as separate ledger movements. Retained earnings is cumulative completed-sale revenue less COGS and expenses. Unassigned business-wide expenses are included in each selected branch view.

The balance sheet's owner-equity value is a balancing figure because owner contributions and withdrawals are not recorded; loan accounts are unsupported. Its zero balance difference is arithmetic, not an independent reconciliation. Keep this limitation visible in the UI and documentation. The auth client represents verification pending without granting a session. Keep Resend credentials and sender configuration in environment variables only; never commit them. Rate limiting currently uses per-identity and coarse global PostgreSQL windows; add trusted-proxy/IP edge throttling before production exposure. Manager permissions remain business-wide settings, while each Manager's API access is constrained to their assigned branch. Sales history is read-only and uses persisted sale snapshots. Responsive/mobile parity, offline device enrollment/synchronization, remaining Tauri-backed modules, and draft route/state parity remain open. Do not mount another feature route until its real server services and parity tests are complete; stop after each approved task and wait for the user's next approval.

## 10. PostgreSQL foundation mapping

The 22 desktop migrations and Rust auth/data operations were audited. Web migrations `0001` and `0002` cover identity/authorization; `0003_business_catalog.sql` adds Settings catalog tables; `0004_products.sql` adds products, selling units, and price history; and `0005_branch_inventory.sql` adds branch inventory. Migrations `0006`-`0014` add supplier/customer directories, purchases, sales, customer debt, cash accounts/expenses, transfers, supplier payments, POS cash collections and corrected customer-debt balances.

| Desktop migration(s) | Audited area | Web mapping / decision |
|---|---|---|
| `001` | Business, branch, roles, permissions, users, audit and settings | PostgreSQL businesses/branches/users/permissions/audit foundation. Two web roles (`admin`, `manager`) are stored directly on users; per-business Manager grants replace the desktop role join for this fixed role model. Settings are deferred. |
| `002` | Product catalogue, categories, brands, units and products | Categories, brands and units are mapped to PostgreSQL by `0003_business_catalog.sql`; products and product-specific units/prices remain deferred. |
| `003–005` | Inventory, movements and costing | Web `0005_branch_inventory.sql` provides branch-scoped balances, movement history and FIFO cost layers with exact scaled integers; sales-driven movements and other inventory operations remain deferred. |
| `006–008` | Sales and price overrides | Web `0008_sales.sql` stores sale/payment snapshots and authorized price overrides; POS consumes branch stock and FIFO cost layers. `0013_pos_cash_collections.sql` assigns collected payments to an account and posts matching ledger movements. |
| `009–011` | Purchases, payments and FIFO cost layers | Web `0007_purchases.sql` stores invoices and receipts; `0012_supplier_payments.sql` stores supplier payments and validates linked cash-ledger postings. Receiving remains distinct from payment. |
| `012–014` | Customers, debt/payments and expenses | Web `0006_suppliers_customers.sql`, `0009_customer_debt_payments.sql`, and `0010_cash_accounts_expenses.sql` cover directories, debt settlement and expenses. |
| `015` | Cash ledger, transfers and immutability triggers | Web `0010_cash_accounts_expenses.sql` and `0011_cash_transfers.sql` implement account-backed movements, openings, expenses and confirmed transfers. |
| `016–019` | Permission catalog and grants | Seed current Rust permission IDs and the exact 20-item default Manager grant set. Obsolete `finance.*` permissions are represented by the later granular expense/debt/balance permissions. |
| `020–021` | Cash-account openings and posting constraints | Web `0010_cash_accounts_expenses.sql` preserves authorized opening balances and account-backed expense posting; retain validation in transactional services. |
| `022` | Desktop owner recovery secrets | Not carried over. Web Admin recovery uses verified email and expiring, hashed one-time tokens. |
| Web `0001` | Identity and authorization | PostgreSQL businesses, branches, Admin/Manager users, Manager permissions, sessions, tokens and audit foundation; no desktop data import. |
| Web `0002` | Auth rate-limit storage | New PostgreSQL table for hashed per-identity/global sensitive-flow throttling windows; it does not import desktop data. |
| Web `0003` | Settings catalog | Business-scoped categories, brands and units. |
| Web `0004` | Product catalog | Business-scoped products, selling units, and price history. |
| Web `0005` | Branch inventory | Per-branch balances, stock movements and FIFO cost layers; no desktop inventory data import. |
| Web `0006` | Supplier and customer directories | Business-scoped supplier/customer records and exact customer credit limits. |
| Web `0007` | Purchases and receipts | Branch-scoped purchase invoices, deliveries and FIFO inventory receipt records. |
| Web `0008` | POS and sales | Branch-scoped completed sales, item/payment snapshots and stock-cost consumption. |
| Web `0009` | Customer debt payments | Credit-sale debt and repayment ledger. |
| Web `0010` | Cash accounts and expenses | Cash-account openings, immutable movements and account-backed expenses. |
| Web `0011` | Cash transfers | Pending and confirmed transfers with transactional paired movements. |
| Web `0013` | POS cash collections | Method- and branch-matched sale payments post incoming cash movements; safe historical backfill leaves ambiguous rows unassigned. |
| Web `0014` | Customer debt balances | Reduces legacy original debt amounts to the unpaid amount after sale-time collections. |

Foundation rules:

- Use PostgreSQL UUIDs, `timestamptz` and native booleans. Money and quantity storage preserves the desktop scales using exact integers (money ×100, quantities ×1000), not floating point.
- Keep server password hashes in the existing Argon2id format; never store raw passwords.
- `users.role` is restricted to Admin/Manager. Admins have no branch and must have an email; Managers must have exactly one branch through their `branch_id`. Tenant-composite foreign keys prevent a user or audit/session reference from crossing businesses. A unique index allows at most one Admin per business, matching the desktop owner-setup model. Multiple Managers on one branch are allowed.
- The permission catalog is seeded from the current Rust constants. The Manager catalog/defaults match the source `MANAGER_PERMISSION_IDS` and `DEFAULT_MANAGER_PERMISSION_IDS`; each business copies those defaults when created. Admins receive business-wide authorization in the future service layer rather than a stored list of Manager grants.
- Session and email tokens are stored only as 32-byte SHA-256 digests. Bootstrap issues no session until the Admin email is verified; a separate online login is required. Recovery accepts only a verified Admin email; Manager password resets remain an authenticated Admin action.
- Resend delivers Admin verification/recovery emails. Verification tokens expire after 24 hours; reset tokens expire after 30 minutes. Both are one-time and hashed; reset completion revokes all active sessions. A verification link performs no state change on GET; the user confirms via POST.
- Session cookies are HttpOnly and SameSite=Lax, Secure in production, use the `__Host-` prefix in production, and correspond to a seven-day server-side expiry. Authentication POST routes validate the configured `WEB_BASE_URL` Origin and return `Cache-Control: no-store`.
- Sensitive flows use hashed per-identity and coarse global rate-limit windows. This is not a substitute for trusted-proxy/IP-level controls at the production edge.
- Row constraints cannot guarantee the aggregate rule that every active branch has an active Manager. The implemented Admin service transaction takes a business-row lock before checking this invariant; every future path that mutates branches or Manager branch/active state must use the same lock and guard.
- The migration runner records checksums and applies the foundation transactionally. No business records or secrets are seeded, and no SQLite import is performed.
