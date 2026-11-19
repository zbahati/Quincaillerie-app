import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { requestSessionToken } from "@/lib/server/auth/http";
import type { NextRequest } from "next/server";

export async function authenticatedDebtContext(request: NextRequest) {
  const context = await findAuthenticatedContext(requestSessionToken(request));
  if (!context) {
    throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
  }
  return context;
}
