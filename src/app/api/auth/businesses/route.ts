import { handleAuthRouteError, jsonResponse } from "@/lib/server/auth/http";
import { listBusinesses } from "@/lib/server/services/auth";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  request.headers.get("cookie");
  try {
    return jsonResponse({ businesses: await listBusinesses() });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
