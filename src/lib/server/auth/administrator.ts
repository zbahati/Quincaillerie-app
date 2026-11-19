import "server-only";

import type { NextRequest } from "next/server";

import { findAuthenticatedContext } from "./authorization";
import { requestSessionToken } from "./http";
import { AuthServiceError } from "./errors";

export async function requireAdministrator(request: NextRequest) {
  const context = await findAuthenticatedContext(requestSessionToken(request));
  if (!context) {
    throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
  }
  if (context.role !== "admin") {
    throw new AuthServiceError(403, "forbidden", "Only the Admin can manage business access.");
  }
  return context;
}
