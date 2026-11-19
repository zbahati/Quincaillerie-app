import {
  clearSessionCookie,
  emptyResponse,
  handleAuthRouteError,
  requestSessionToken,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { signOut } from "@/lib/server/services/auth";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    await signOut(requestSessionToken(request));
    const response = emptyResponse();
    clearSessionCookie(response);
    return response;
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
