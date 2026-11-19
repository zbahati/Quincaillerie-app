import "server-only";

import { hashOpaqueToken } from "./crypto";
import { AuthServiceError } from "./errors";
import { getDatabasePool } from "../db/pool";
import { consumeAuthRateLimit } from "../repositories/auth-rate-limits";

export async function enforceAuthRateLimit(
  scope: string,
  identity: string,
  maximumRequests: number,
  windowSeconds: number,
): Promise<void> {
  const result = await consumeAuthRateLimit(
    getDatabasePool(),
    hashOpaqueToken(`${scope}:${identity}`),
    maximumRequests,
    windowSeconds,
  );
  if (!result.allowed) {
    throw new AuthServiceError(
      429,
      "rate_limited",
      "Too many attempts. Try again later.",
      result.retryAfterSeconds,
    );
  }
}
