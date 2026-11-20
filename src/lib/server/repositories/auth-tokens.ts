import "server-only";

import type { PoolClient } from "pg";

import type { PgExecutor } from "./businesses";

export interface AdminIdentityReference {
  userId: string;
  businessId: string;
}

export interface AdminEmailRecord extends AdminIdentityReference {
  email: string;
  fullName: string;
}

export async function findUnverifiedAdminByEmail(
  executor: PgExecutor,
  businessId: string,
  email: string,
): Promise<AdminEmailRecord | null> {
  const result = await executor.query<AdminEmailRecord>(
    `SELECT
       user_row.id AS "userId",
       user_row.business_id AS "businessId",
       user_row.email,
       user_row.full_name AS "fullName"
     FROM users AS user_row
     JOIN businesses AS business ON business.id = user_row.business_id
     WHERE user_row.business_id = $1
       AND user_row.email = $2
       AND user_row.role = 'admin'
       AND user_row.email_verified_at IS NULL
       AND user_row.is_active = TRUE
       AND business.is_active = TRUE`,
    [businessId, email],
  );
  return result.rows[0] ?? null;
}

export async function findVerifiedAdminByEmail(
  executor: PgExecutor,
  businessId: string,
  email: string,
): Promise<AdminEmailRecord | null> {
  const result = await executor.query<AdminEmailRecord>(
    `SELECT
       user_row.id AS "userId",
       user_row.business_id AS "businessId",
       user_row.email,
       user_row.full_name AS "fullName"
     FROM users AS user_row
     JOIN businesses AS business ON business.id = user_row.business_id
     WHERE user_row.business_id = $1
       AND user_row.email = $2
       AND user_row.role = 'admin'
       AND user_row.email_verified_at IS NOT NULL
       AND user_row.is_active = TRUE
       AND business.is_active = TRUE`,
    [businessId, email],
  );
  return result.rows[0] ?? null;
}

export async function createAdminEmailVerificationToken(
  client: PoolClient,
  input: {
    businessId: string;
    userId: string;
    tokenHash: Buffer;
    expiresAt: Date;
  },
): Promise<string> {
  await client.query(
    `UPDATE admin_email_verification_tokens
     SET consumed_at = now()
     WHERE business_id = $1 AND user_id = $2 AND consumed_at IS NULL`,
    [input.businessId, input.userId],
  );
  const result = await client.query<{ id: string }>(
    `INSERT INTO admin_email_verification_tokens
       (business_id, user_id, token_hash, expires_at)
     SELECT user_row.business_id, user_row.id, $3, $4
     FROM users AS user_row
     JOIN businesses AS business ON business.id = user_row.business_id
     WHERE user_row.business_id = $1
       AND user_row.id = $2
       AND user_row.role = 'admin'
       AND user_row.email IS NOT NULL
       AND user_row.email_verified_at IS NULL
       AND user_row.is_active = TRUE
       AND business.is_active = TRUE
     RETURNING id`,
    [input.businessId, input.userId, input.tokenHash, input.expiresAt],
  );
  const tokenId = result.rows[0]?.id;
  if (!tokenId) {
    throw new Error("An email-verification token can only be issued to an active, unverified Admin.");
  }
  return tokenId;
}

export async function verifyAdminEmail(
  client: PoolClient,
  tokenHash: Buffer,
): Promise<AdminIdentityReference | null> {
  const result = await client.query<AdminIdentityReference>(
    `WITH consumed AS (
       UPDATE admin_email_verification_tokens
       SET consumed_at = now()
       WHERE token_hash = $1
         AND consumed_at IS NULL
         AND expires_at > now()
       RETURNING business_id, user_id
     )
     UPDATE users AS user_row
     SET email_verified_at = now(), updated_at = now()
     FROM consumed, businesses AS business
     WHERE user_row.business_id = consumed.business_id
       AND user_row.id = consumed.user_id
       AND user_row.role = 'admin'
       AND user_row.email IS NOT NULL
       AND user_row.email_verified_at IS NULL
       AND user_row.is_active = TRUE
       AND business.id = user_row.business_id
       AND business.is_active = TRUE
     RETURNING user_row.id AS "userId", user_row.business_id AS "businessId"`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function verifyUnverifiedAdminWithSetupSecret(
  client: PoolClient,
  businessId: string,
  email: string,
): Promise<AdminIdentityReference | null> {
  const result = await client.query<AdminIdentityReference>(
    `UPDATE users AS user_row
     SET email_verified_at = now(), updated_at = now()
     FROM businesses AS business
     WHERE user_row.business_id = $1
       AND user_row.email = $2
       AND user_row.role = 'admin'
       AND user_row.email_verified_at IS NULL
       AND user_row.is_active = TRUE
       AND business.id = user_row.business_id
       AND business.is_active = TRUE
     RETURNING user_row.id AS "userId", user_row.business_id AS "businessId"`,
    [businessId, email],
  );
  const identity = result.rows[0] ?? null;
  if (!identity) {
    return null;
  }

  await client.query(
    `UPDATE admin_email_verification_tokens
     SET consumed_at = now()
     WHERE business_id = $1 AND user_id = $2 AND consumed_at IS NULL`,
    [identity.businessId, identity.userId],
  );
  return identity;
}

export async function createAdminPasswordResetToken(
  client: PoolClient,
  input: {
    businessId: string;
    userId: string;
    tokenHash: Buffer;
    expiresAt: Date;
  },
): Promise<string> {
  await client.query(
    `UPDATE password_reset_tokens
     SET consumed_at = now()
     WHERE business_id = $1 AND user_id = $2 AND consumed_at IS NULL`,
    [input.businessId, input.userId],
  );
  const result = await client.query<{ id: string }>(
    `INSERT INTO password_reset_tokens
       (business_id, user_id, token_hash, expires_at)
     SELECT user_row.business_id, user_row.id, $3, $4
     FROM users AS user_row
     JOIN businesses AS business ON business.id = user_row.business_id
     WHERE user_row.business_id = $1
       AND user_row.id = $2
       AND user_row.role = 'admin'
       AND user_row.email_verified_at IS NOT NULL
       AND user_row.is_active = TRUE
       AND business.is_active = TRUE
     RETURNING id`,
    [input.businessId, input.userId, input.tokenHash, input.expiresAt],
  );
  const tokenId = result.rows[0]?.id;
  if (!tokenId) {
    throw new Error("A password-reset token can only be issued to an active, verified Admin.");
  }
  return tokenId;
}

export async function completeAdminPasswordReset(
  client: PoolClient,
  tokenHash: Buffer,
  passwordHash: string,
): Promise<AdminIdentityReference | null> {
  const result = await client.query<AdminIdentityReference>(
    `WITH consumed AS (
       UPDATE password_reset_tokens
       SET consumed_at = now()
       WHERE token_hash = $1
         AND consumed_at IS NULL
         AND expires_at > now()
       RETURNING business_id, user_id
     )
     UPDATE users AS user_row
     SET password_hash = $2, updated_at = now()
     FROM consumed, businesses AS business
     WHERE user_row.business_id = consumed.business_id
       AND user_row.id = consumed.user_id
       AND user_row.role = 'admin'
       AND user_row.email_verified_at IS NOT NULL
       AND user_row.is_active = TRUE
       AND business.id = user_row.business_id
       AND business.is_active = TRUE
     RETURNING user_row.id AS "userId", user_row.business_id AS "businessId"`,
    [tokenHash, passwordHash],
  );
  return result.rows[0] ?? null;
}
