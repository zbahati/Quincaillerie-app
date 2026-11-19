import "server-only";

import type { Pool } from "pg";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function consumeAuthRateLimit(
  pool: Pool,
  keyHash: Buffer,
  maximumRequests: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  await pool.query("DELETE FROM auth_rate_limits WHERE expires_at <= now()");
  const result = await pool.query<{
    requestCount: number;
    retryAfterSeconds: number;
  }>(
    `INSERT INTO auth_rate_limits AS rate_limit
       (key_hash, window_started_at, request_count, expires_at)
     VALUES ($1, now(), 1, now() + make_interval(secs => $2))
     ON CONFLICT (key_hash) DO UPDATE
     SET window_started_at = CASE
           WHEN rate_limit.window_started_at <= now() - make_interval(secs => $2)
             THEN now()
           ELSE rate_limit.window_started_at
         END,
         request_count = CASE
           WHEN rate_limit.window_started_at <= now() - make_interval(secs => $2)
             THEN 1
           ELSE rate_limit.request_count + 1
         END,
         expires_at = CASE
           WHEN rate_limit.window_started_at <= now() - make_interval(secs => $2)
             THEN now() + make_interval(secs => $2)
           ELSE rate_limit.expires_at
         END
     RETURNING
       request_count AS "requestCount",
       GREATEST(
         1,
         CEIL(EXTRACT(EPOCH FROM (expires_at - now())))::INTEGER
       ) AS "retryAfterSeconds"`,
    [keyHash, windowSeconds],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("PostgreSQL did not return the auth rate-limit result.");
  }
  return {
    allowed: row.requestCount <= maximumRequests,
    retryAfterSeconds: row.retryAfterSeconds,
  };
}
