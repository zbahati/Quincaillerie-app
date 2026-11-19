# Quincaillerie Manager V1 - Cloudflare Workers and Neon Deployment Audit

**Audit date:** 2026-11-19  
**Scope:** `web application/` only  
**Approved target:** Cloudflare Workers, Neon PostgreSQL, GitHub  
**Current conclusion:** **READY AFTER SPECIFIC CHANGES**

This document is an implementation plan, not a deployment authorization. It does not publish resources, create Neon/Cloudflare projects, run production migrations, or expose secrets.

## 1. Executive summary

The application has a suitable server-side PostgreSQL architecture and already passes local functional validation. It is not immediately deployable to Cloudflare Workers.

The main blockers are:

1. `pg` uses TCP/long-lived connection pooling, while Workers require serverless HTTP or WebSocket database connectivity.
2. `@node-rs/argon2` contains native N-API binaries and is not known to be a verified Workers-compatible dependency.
3. The current Next.js 16.4.6 adapter path has not been compatibility-tested on Workers. Cloudflare now recommends vinext for new Next.js migrations, while OpenNext remains a possible established route.
4. The app includes `node:crypto`, `Buffer`, streaming export code and a legacy Tauri import in an inactive employee module. These need bundle/runtime verification.

No deployment blocker was found in PostgreSQL schema, transactions, financial calculations, or the absence of file uploads/PDF generation.

The recommended V1 architecture is:

```text
Users / Installed PWA
  -> Cloudflare DNS + TLS
  -> Cloudflare Workers
     -> Next.js application adapted for Workers
     -> Server route handlers and services
     -> Neon pooled serverless PostgreSQL
  -> Neon PostgreSQL
  -> Independent pg_dump backup storage
```

Do not add R2 for V1 unless uploads or persistent product documents become required.

## 2. Existing web application architecture

### Framework

- Next.js 16.4.6
- React 19.3.0
- TypeScript 5
- Tailwind CSS 4
- npm with `package-lock.json`
- Next.js App Router
- Standalone Docker output
- Next.js cache components enabled
- No server actions observed
- No Next.js middleware observed
- Route handlers provide the application API

### Application structure

- Business-scoped authentication and session APIs
- Server-side repositories and services
- PostgreSQL transaction helper
- Zod request schemas
- Admin and Manager authorization
- Branch-scoped inventory, POS, purchasing and reports
- JSON business-data export
- PWA manifest and service worker
- 14 ordered SQL migrations
- 17 PostgreSQL integration tests
- Unit and browser validation

### Database architecture

The project uses SQL-first `pg` repositories rather than Drizzle or another ORM. This is compatible with PostgreSQL and does not require an ORM migration to Neon.

All financial writes use PostgreSQL transactions or repository transaction boundaries. The schema uses PostgreSQL types and constraints, including exact integer-scaled money and quantities.

### Browser/PWA behavior

- Static assets and public app-shell responses may be cached
- `/api/*`, verification and password-reset routes are excluded
- Offline navigation uses an explicit fallback
- No offline POS write outbox or synchronization exists
- PWA shell support is independent of database hosting

## 3. Cloudflare Workers compatibility matrix

| Area | Observed state | Cloudflare status | Severity | Required action |
|---|---|---|---|---|
| App Router | Multiple layouts/pages/routes | Requires practical adapter test | High | Run compatibility/build smoke test first |
| Route handlers | 60+ route handler modules | Supported by Workers adapters, but test | Medium | Exercise auth and POST routes |
| Server components | Used | Adapter-dependent | Medium | Run render and navigation test |
| Server actions | None observed | Not a blocker | Low | None |
| Middleware | None observed | Not a blocker | Low | None |
| Cookies | HttpOnly session cookies | Supported | Low | Preserve `Secure`, `HttpOnly`, `SameSite=Lax` |
| PostgreSQL `pg` | TCP pool and `PoolClient` transactions | Not suitable for Workers as-is | Critical | Replace runtime database access with Neon serverless connectivity |
| Argon2 | `@node-rs/argon2` native package | Not verified for Workers | Critical | Practical bundle/runtime test or Workers-compatible Argon2 implementation |
| `node:crypto` | Random bytes, SHA-256 | Supported with Node compatibility or Web Crypto | Low | Verify in deployed runtime |
| `Buffer` | Session/token database values | Supported with Node compatibility | Low | Verify bundle/runtime behavior |
| Streaming JSON export | `ReadableStream` in route service | Worker stream support, 128 MB memory limit | Medium | Paginate/chunk and test large exports |
| Zod | Zod 4 | Compatible with current runtime; avoid huge in-memory schemas | Low | Pin/verify tested version |
| Resend | HTTP fetch | Compatible | Low | Use runtime secret and exact HTTPS origin |
| Tauri package | Legacy inactive employee module only | Not production runtime logic | Medium | Remove dead Tauri import/module before Workers bundle |
| File storage | No upload/storage implementation | No R2 needed | Low | None |
| PDF generation | None observed | No special service needed | Low | None |
| Background jobs | None observed | Not a blocker | Low | Add external schedule only if needed later |

## 4. Next.js and adapter compatibility

Cloudflare currently recommends vinext for migration of existing Next.js applications to Workers, while noting that vinext is beta. OpenNext Cloudflare is the established Next-to-Workers adapter route referenced by the original audit requirements.

For this project, the safest implementation order is:

1. Run a non-destructive compatibility check in a separate branch.
2. Prefer the established OpenNext Cloudflare path for the first pilot if it supports Next.js 16 and cache components.
3. If OpenNext cannot support Next.js 16/cache components reliably, assess vinext in an isolated preview branch.
4. Do not migrate to vinext by default when OpenNext passes the complete build and smoke test.

The app must be tested for:

- App Router navigation
- Dynamic route segments
- Route handlers
- Streaming responses
- HTTP cookies
- Static assets
- PWA manifest and service worker
- Cache components
- Standalone build behavior
- Database transactions

**Status:** practical deployment test is still required.

## 5. Node.js dependency compatibility

### `@node-rs/argon2`

The application hashes passwords and verifies login passwords with `@node-rs/argon2`. The package provides native Node bindings, not a portable Web standard implementation.

This is the highest runtime blocker. Do not assume that adding `nodejs_compat` makes a native binary work. The package must be deployed and tested in a real Workers compatibility environment before production authorization.

Options:

1. Establish that the package or an architecture-specific compatible build works in Workers, preserving existing Argon2id parameters.
2. Port verification to a Workers-compatible Argon2/WASM implementation while maintaining a migration and verification compatibility path for existing hashes.
3. If Argon2 cannot run safely on Workers, use a dedicated Node.js auth service only as a temporary architecture exception.

Do not replace Argon2id with a weaker algorithm in the initial migration.

### `pg`

`pg` is not suitable for an edge Worker as the project's only runtime database driver:

- It depends on persistent TCP socket-style connections.
- It creates a local pool inside an isolate.
- Transaction clients depend on interactive sessions.
- Reusing `pg.Pool` across isolates is not durable or predictable.

The application also relies heavily on `BEGIN`, `COMMIT`, `ROLLBACK`, `PoolClient` and `FOR UPDATE`. The implementation needs adaptation to a Workers-compatible PostgreSQL driver that preserves interactive transaction support.

### Neon serverless driver

Use `@neondatabase/serverless` for runtime access. Its WebSocket `Pool`/`Client` compatibility mode is appropriate for `node-postgres`-style interactive transactions. HTTP/neon SQL is suitable for one-shot queries and non-interactive operations, but should not replace the transaction helper until the repository layer is validated.

The implementation phase should maintain two connections:

- `DATABASE_URL`: pooled Neon application connection.
- `DATABASE_URL_DIRECT`: direct Neon connection for migrations and administrative tools.

Never expose either connection string to browser code.

### Other dependencies

- `node:crypto`: use only supported APIs or Web Crypto equivalents.
- `Buffer`: verify with Workers Node compatibility.
- `ReadableStream`: supported in Workers and used for exports.
- `lucide-react`, `radix-ui`, Zod, React and Next dependencies: normal browser/build dependencies, but bundle size must be measured.
- `@tauri-apps/api/core`: remove from active source because the route uses the web API implementation.
- Resend: HTTP-compatible.

## 6. Runtime and resource constraints

### Cloudflare Workers free plan

Official Cloudflare limits observed for the current plan include:

- 100,000 requests per day
- 10 ms CPU time per HTTP invocation
- 128 MB memory per isolate
- 64 MiB Worker size
- 50 subrequests per request
- 6 simultaneous outgoing connections

CPU wait time does not count for database network calls, but password hashing and large reports may use CPU and memory.

The free tier is suitable for a small controlled pilot, not for a busy production business, if all workflows stay under request and CPU limits.

### Application risk

The following operations need explicit staging measurements:

- Password hash and verification
- Login rate-limited flows
- POS checkout
- Inventory corrections and FIFO calculation
- Large business JSON exports
- Income/balance-sheet reports
- Long customer/supplier lists
- Static asset delivery

Business export should use server streaming and a small bounded chunk size. Do not generate the entire export in memory in a large business.

## 7. Neon PostgreSQL compatibility

Neon PostgreSQL is compatible with the existing SQL-first PostgreSQL implementation. It does not require D1 or another database.

Recommended regions:

- Choose a Neon region after latency testing from Rwanda.
- Do not assume Rwanda benefits from an arbitrary US/EU region.
- Run simple latency and 95th-percentile checkout tests from the actual Cloudflare region and pilot devices.
- Consider Neon scale-to-zero behavior for a free pilot.

Neon Free plan behavior must be evaluated against:

- 100 CU-hours/project
- 1 GB storage/project
- 20 GB account storage
- 100 projects
- 5 GB project egress
- 5-minute compute suspension
- 6-hour instant history/restore window

The free tier is useful for a pilot but is not a production backup strategy.

Use Neon branches for staging and preview databases, never for production backup-only recovery.

## 8. Authentication and Argon2 compatibility

### Verified design

- Server-side Argon2id password hash storage
- SHA-256 opaque token hashing
- HttpOnly session cookie
- `Secure` in production
- `SameSite=Lax`
- Seven-day session lifetime
- Server-side session revocation
- Same-origin POST validation
- Zod request validation
- PostgreSQL-backed rate limits
- Admin and Manager role checks
- Branch and business tenant checks

### Cloudflare implementation risks

- Native Argon2 package
- Neon WebSocket support
- Exact `WEB_BASE_URL` origin
- `__Host-` cookie behavior
- Trusted proxy/IP edge throttle
- Large concurrent login bursts

The session secret is not required by the current opaque-token design. Do not introduce a secret or change session format without explicit migration planning.

## 9. Financial data integrity

No deployment architecture change should duplicate or reimplement financial calculations.

Preserve:

- Integer-scaled RWF amounts
- Integer-scaled thousandth quantities
- PostgreSQL transactions
- Sale snapshots
- Persisted sale-item cost
- FIFO cost layers
- Customer debt balances after sale-time payments
- Supplier payment and cash-movement reconciliation
- Transfer mirrored ledger movements
- Immutability and audit records

The Neon migration must run against PostgreSQL 17-compatible SQL. SQL migrations are already checksum-tracked.

Before production:

1. Apply migrations to a disposable Neon branch/database.
2. Run all 17 PostgreSQL integration tests.
3. Run POS, inventory, purchasing and financial statement smoke tests.
4. Compare exact totals against representative local fixtures.
5. Test concurrent checkout and payment behavior.
6. Recheck that no rounding or floating-point conversion was introduced.

## 10. File storage and document generation

No application component currently:

- Uploads product images
- Uploads business documents
- Generates PDFs
- Writes temporary files
- Requires local persistent application storage
- Uses a file system backup/restore service

R2 is therefore optional and not required for V1.

The business JSON export is streamed from PostgreSQL and contains sensitive information. It must remain authenticated and should be limited to Admin users.

Do not enable public R2 access unless a future approved feature requires it.

## 11. Security assessment

### Strengths

- Server-side authorization
- Business and branch scoping
- Parameterized SQL
- Zod validation
- Atomic transactions
- HttpOnly session cookies
- Same-origin checks
- No-store/auth cache controls
- Global CSP, frame, MIME and referrer protections
- Production HSTS
- Sensitive exports exclude authentication secrets

### Required improvements

| Issue | Severity | File/area | Required solution |
|---|---|---|---|
| Trusted-proxy/IP throttle absent | High | Auth/rate-limit implementation | Add Cloudflare-aware edge or proxy throttle |
| CSP allows inline/eval scripts | Medium | `next.config.ts` | Add nonce hardening after Next/adapter compatibility |
| Native Argon2 not proven on Workers | Critical | `src/lib/server/auth/crypto.ts` | Prove runtime or adapt securely |
| TCP `pg` pool not edge-compatible | Critical | `src/lib/server/db/pool.ts` | Replace runtime pool with Neon serverless mode |
| Legacy Tauri import in inactive module | Medium | `src/modules/employees/employees-page.tsx` | Remove dead Tauri code/import |
| Full audit history lacks external edge monitoring | Medium | Deployment operations | Add Cloudflare log/alert integration |
| Neon credentials absent from runbook | Medium | Environment configuration | Configure secret bindings, never source code |

## 12. Free-tier limitations

### Cloudflare Workers Free

Benefits:

- HTTPS and Cloudflare DNS/TLS
- 100,000 requests/day
- Static assets separated from Worker invocation
- Low initial cost
- Automatic edge routing

Risks:

- 10 ms CPU limit can terminate expensive hashing or report work
- 128 MB memory limit
- 64 MiB Worker size
- Daily request limit
- 50 subrequests/request
- Free-plan operational availability may not be suitable for real financial operations

Upgrade Cloudflare Workers when:

- Daily requests approach 80,000
- CPU limit causes 1102 errors
- A pilot needs paid observability or more reliable limits
- Burst logins or exports consume the free request quota

### Neon Free

Benefits:

- Permanent free tier
- Scale-to-zero
- PostgreSQL and instant restore
- Small pilot database

Risks:

- 1 GB/project storage
- 100 CU-hours/project
- 5-minute scale-to-zero can add cold-start latency
- 6-hour restore history
- No production-grade independent backup substitute
- Egress/storage limits

Upgrade Neon for production when:

- Storage nears 1 GB
- Compute is frequently exhausted
- Restore history is insufficient
- Scheduled backup or higher monitoring retention is required
- Real-time availability exceeds free limits

### Resend

Email is required for Admin verification and password reset. Use the provider's current free/pilot quota only if the provider has supported sender verification and quota for the expected mail volume. Confirm current limits before activation.

No R2 is required for V1.

## 13. Deployment architecture recommendation

Use GitHub-connected deployments:

```text
main
  -> GitHub Actions build/test
  -> Neon staging branch
  -> Cloudflare preview Worker
  -> Acceptance tests
  -> Neon production migration backup
  -> Cloudflare production Worker
```

Required services:

- GitHub source repository
- Cloudflare Workers
- Neon PostgreSQL
- Resend
- Independent encrypted backup storage

Optional for later:

- R2 for uploads/documents
- Cloudflare Queues or Durable Objects for offline sync
- Scheduled Cron backup jobs
- Paid observability

Do not add R2, queues or durable objects for a pilot with no file uploads or offline writes.

## 14. Required configuration and environment variables

| Variable | Secret | Build/runtime | Purpose |
|---|---:|---|---|
| `DATABASE_URL` | Yes | Runtime | Neon pooled application connection |
| `DATABASE_URL_DIRECT` | Yes | Migration/runtime only | Neon direct administrative connection |
| `WEB_BASE_URL` | No | Runtime | Exact public HTTPS origin for cookies/email/CSRF |
| `RESEND_API_KEY` | Yes | Runtime | Verification/reset email delivery |
| `RESEND_FROM_EMAIL` | No | Runtime | Verified sender identity |
| `NODE_ENV` | No | Build/runtime | Production cookie and optimization behavior |

Optional future:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `NEON_API_KEY`
- `BACKUP_ENCRYPTION_KEY`
- `R2_*` only if object storage is approved

Configure secrets in Cloudflare and GitHub Actions rather than `.env` files. `.env`, `.env.local` and PostgreSQL credentials must remain untracked.

## 15. Backup and recovery

The browser JSON export is not a database backup.

V1 backup requirements:

1. Confirm Neon instant restore history and retention.
2. Take a pre-migration Neon branch or snapshot.
3. Run an encrypted `pg_dump` backup before migrations.
4. Store backups outside Neon and Cloudflare application instances.
5. Schedule nightly/at-least-daily independent backups for real pilot data.
6. Encrypt backups and restrict access.
7. Keep restore credentials separate from application credentials.
8. Test restore into a disposable Neon branch.

The `pg_dump`/`pg_restore` workflow remains compatible with PostgreSQL and Neon direct connections.

Restore acceptance must verify:

- Schema and migration status
- Admin login
- POS sale totals
- Inventory/FIFO
- Customer debts
- Purchase/supplier payables
- Cash movements
- Financial statements

## 16. Critical blockers

1. Native Argon2 compatibility is unverified.
2. `pg.Pool` must not remain the runtime database driver.
3. OpenNext/vinext compatibility with Next.js 16/cache components is unverified.
4. Live Neon latency and scale-to-zero behavior are unmeasured.
5. Free-plan CPU/Worker limit behavior is unmeasured for login, exports and reports.
6. Trusted-proxy edge throttling is not implemented.
7. Restore and independent backup automation have not been exercised.

Do not run a real-data migration until all six blockers are closed.

## 17. Recommended improvements

Before implementation:

- Remove the dormant Tauri employee module and import.
- Add database driver compatibility tests.
- Add an Argon2 Worker compatibility test.
- Add a Neon staging database.
- Add an adapter preview deployment.
- Add worker CPU/memory/export measurements.
- Add an independent backup workflow.
- Add trusted-proxy/rate-limit configuration.
- Add nonce-based CSP if the adapter supports it.
- Add migration dry-run and checksum reporting.
- Add environment validation at startup.

No code changes are required for this audit-only plan until approval.

## 18. Deployment implementation plan

### Phase A - Compatibility prototype

1. Create a GitHub branch.
2. Add Neon staging credentials locally only.
3. Replace runtime `pg.Pool` access with a Neon serverless compatible transaction adapter.
4. Deploy a compatibility build to a Cloudflare preview Worker.
5. Test Argon2, login, logout and session restoration.
6. Test Neon connectivity and transactions.
7. Test App Router navigation and route handlers.
8. Measure CPU, memory and bundle size.

### Phase B - Staging database

1. Create a Neon staging project/branch.
2. Apply migrations with `DATABASE_URL_DIRECT`.
3. Run unit tests.
4. Run all 17 PostgreSQL integration tests.
5. Seed synthetic staging data only.
6. Exercise V1 workflows.
7. Run an independent backup and restore drill.

### Phase C - Preview deployment

1. Configure GitHub preview deployment.
2. Set Cloudflare secrets.
3. Set exact staging `WEB_BASE_URL`.
4. Configure Resend staging sender.
5. Verify HTTPS, HSTS and CSP.
6. Verify PWA install and offline fallback.
7. Verify no private API response enters CacheStorage.
8. Stop before production approval if any smoke test fails.

### Phase D - Controlled pilot

1. Back up the intended source database before migration.
2. Apply migrations in a maintenance window.
3. Deploy the Worker.
4. Run migration, auth and reconciliation checks.
5. Enable 3-5 synthetic pilot users or one approved real branch.
6. Monitor for 7-14 days.
7. Do not enable wider tenant data until backup and restore verification passes.

### Phase E - Upgrade triggers

Move to paid plans or a dedicated Node host if:

- Workers CPU limits affect login or reports
- Native Argon2 cannot be made reliable
- Neon cold-start or egress latency is unacceptable
- 100,000 requests/day is insufficient
- Independent backups or restore history are inadequate
- Real financial operations require stronger availability controls

## 19. V1 production acceptance checklist

- [ ] OpenNext or vinext compatibility test passes in preview
- [ ] Neon serverless runtime and transactions pass integration tests
- [ ] Argon2 hashes verify and new hashes remain Argon2id
- [ ] Existing session behavior is migrated or invalidated explicitly
- [ ] Admin bootstrap and email verification work
- [ ] Password reset and session revocation work
- [ ] HTTPS, HSTS and security headers verify
- [ ] Trusted-proxy/rate limiting is active
- [ ] POS, inventory, purchasing, debts and reports reconcile
- [ ] Database migrations are checksum-verified
- [ ] Direct and pooled Neon URLs are separate
- [ ] Secrets are absent from GitHub, browser and logs
- [ ] Independent encrypted backup exists
- [ ] Neon restore drill passes
- [ ] Worker CPU/memory/bundle limits pass
- [ ] Rwanda-to-Neon latency is measured
- [ ] PWA install and offline shell are verified
- [ ] Private APIs are never cached
- [ ] Production monitoring and alerts are active
- [ ] Rollback image/branch and maintenance procedure are tested
- [ ] Explicit business approval is recorded

## 20. Cost and upgrade summary

| Service | Free-pilot fit | Main limit | Upgrade trigger |
|---|---|---|---|
| Cloudflare Workers | Suitable for controlled small pilot | 100k requests/day, 10 ms CPU, 128 MB, 64 MiB bundle | Requests/CPU/bundle or observability |
| Neon PostgreSQL | Suitable for small staging/pilot | 1 GB storage/project, 100 CU-hours, scale-to-zero | Storage/compute/retention/recovery |
| Resend | Suitable only after sender and quota check | Free sender/mail quota | Mail volume/deliverability |
| R2 | Not required for V1 | Storage/request/egress as applicable | First approved file upload/document feature |

Free hosting is not production-grade disaster recovery or guaranteed availability. Use the minimum paid tier when real customer financial data or multi-business operations exceed pilot assumptions.

## 21. Free-pilot geographic recommendation

No latency measurement was performed in this audit. The only defensible recommendation is:

1. Create Neon and Cloudflare preview resources in candidate regions.
2. Measure database round trips from Rwanda-based pilot devices.
3. Keep the Neon database close to the expected data workload.
4. Keep Worker edge delivery global through Cloudflare.
5. Re-measure POS checkout and report requests before production.

Do not assume a region solely from geography.

## 22. Final decision

**B. READY AFTER SPECIFIC CHANGES**

The existing architecture is suitable for a Cloudflare Workers/Neon free pilot, but deployment must wait for:

- Neon serverless PostgreSQL transaction adapter
- Argon2 Worker compatibility verification
- OpenNext/vinext compatibility testing
- Dead Tauri import removal
- Edge throttle and restore drill

The least disruptive alternative is a paid or free Node.js/container host with Neon PostgreSQL if Argon2 or Next adapter compatibility fails. That alternative preserves the existing Next.js and PostgreSQL architecture without a major financial-logic rewrite.

## 23. Official references used

- Cloudflare Workers pricing: <https://developers.cloudflare.com/workers/platform/pricing/>
- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare Node.js compatibility: <https://developers.cloudflare.com/workers/runtime-apis/nodejs/>
- Cloudflare Next.js guide: <https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/>
- Neon serverless driver: <https://neon.com/docs/serverless/serverless-driver>
- Neon pricing: <https://neon.com/pricing>
- Neon branching: <https://neon.com/docs/introduction/branching>
- Neon backup strategies: <https://neon.com/docs/postgres/backup-restore/backups>
