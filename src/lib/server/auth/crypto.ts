import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

let dummyPasswordHash: Promise<string> | null = null;

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return verify(passwordHash, password);
}

export async function verifyPasswordOrDummy(
  password: string,
  passwordHash: string | null,
): Promise<boolean> {
  if (passwordHash) {
    return verifyPassword(password, passwordHash);
  }

  dummyPasswordHash ??= hash(randomBytes(32), ARGON2_OPTIONS);
  await verifyPassword(password, await dummyPasswordHash);
  return false;
}

export const AUTH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function authSessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Host-qk_session"
    : "qk_session";
}
