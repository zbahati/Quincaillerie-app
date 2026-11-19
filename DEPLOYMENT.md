# Deployment Readiness

This document describes a staging and production rollout for the Quincaillerie web application. It is not authorization to publish, migrate production data, or incur hosting costs.

## Production topology

- Run the Next.js standalone image behind HTTPS.
- Run PostgreSQL 17 outside the public network.
- Allow only the web application to reach PostgreSQL on the database port.
- Terminate TLS at the reverse proxy/load balancer.
- Configure the proxy to preserve `X-Forwarded-Proto` and send only trusted proxy traffic.
- Keep PostgreSQL backups and restore credentials outside the application container.

## Required environment

- `DATABASE_URL`: PostgreSQL connection URL for the application role.
- `WEB_BASE_URL`: exact public HTTPS origin, for example `https://manager.example.com`.
- `RESEND_API_KEY`: verified Resend API key.
- `RESEND_FROM_EMAIL`: sender from a verified Resend domain.
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`: only for the local Compose database service.
- `NODE_ENV=production`: set by the container image.

Do not commit real credentials or copy `.env` files into Docker images. Inject secrets through the deployment platform.

## Database migrations

Apply `db/migrations/*.sql` before routing traffic to a new web release:

```powershell
docker compose -p quincaillerie-web-staging run --rm migrate
```

The migration runner applies one migration at a time in PostgreSQL transactions and rejects changed checksums for already-applied migrations. Review every migration diff and create a backup before applying it.

## Image and staging validation

```powershell
docker compose -p quincaillerie-web-staging build web
docker compose -p quincaillerie-web-staging up -d db
docker compose -p quincaillerie-web-staging run --rm migrate
docker compose -p quincaillerie-web-staging up -d web
Invoke-WebRequest -UseBasicParsing https://staging.example.com/api/health
```

The health endpoint requires database connectivity and returns HTTP 503 when PostgreSQL is unavailable.

Before approval, validate:

- HTTPS redirect and valid certificates.
- Exact `WEB_BASE_URL` matches the browser origin.
- Admin bootstrap, verification email, sign-in, logout, session expiry and password reset.
- POS, inventory, purchasing, debt, cash and report workflows against synthetic staging data.
- Security headers and CSP at the public origin.
- Database and application container health checks.
- Logs contain errors without passwords, tokens or database credentials.

## Backups

Use managed PostgreSQL snapshots or `pg_dump`, never the browser export as a database backup:

```powershell
docker compose -p quincaillerie-web-production exec -T db pg_dump -Fc -U quincaillerie quincaillerie > quincaillerie-production.dump
```

Store encrypted, access-controlled, off-host copies. Define an owner, schedule, retention period and recovery objective before production. Back up before every migration and application deployment.

## Restore drill

Restore only in an isolated staging environment with a disposable database:

```powershell
docker compose -p quincaillerie-web-staging exec -T db pg_restore --clean --if-exists -U quincaillerie -d quincaillerie < quincaillerie-production.dump
```

A successful restore should be followed by migration status verification and a reconciliation smoke test covering login, sales, inventory, receivables, supplier payables, cash and reports.

## Monitoring and retention

Monitor:

- `/api/health` status and PostgreSQL connectivity.
- Application/container restarts.
- Database connections, disk, memory and CPU.
- HTTP 5xx and response latency.
- Migration and backup job success.
- Failed login and rate-limit spikes.
- Disk growth and audit/export record retention.

Define log retention, audit retention and database backup retention with the business owner. Do not log session tokens, password reset tokens, verification tokens or password values.

## Rollback

- Keep the previous web image and database snapshot.
- Roll back application traffic before schema rollback.
- Do not automatically reverse migrations; most business migrations are not safely reversible.
- Restore data only in a controlled maintenance window after stopping writes.
- Verify migration checksums, health, authentication and reconciliation smoke tests after rollback.

## Remaining release gates

- Add trusted-proxy/IP edge throttling.
- Harden CSP with nonces instead of `'unsafe-inline'` and `'unsafe-eval'`.
- Decide supported browsers and PWA update behavior.
- Complete a real staging restore drill.
- Configure managed database backups and alerting.
- Obtain explicit approval before production migration or publication.
