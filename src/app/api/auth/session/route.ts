import {
  handleAuthRouteError,
  jsonResponse,
  requestSessionToken,
} from "@/lib/server/auth/http";
import { currentSession } from "@/lib/server/services/auth";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const sessionToken = requestSessionToken(request);
  try {
    return jsonResponse({ session: await currentSession(sessionToken) });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
