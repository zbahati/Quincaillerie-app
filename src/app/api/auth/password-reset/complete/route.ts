import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { adminPasswordResetCompletionSchema } from "@/lib/server/schemas/identity";
import { completeAdminPasswordReset } from "@/lib/server/services/auth";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const input = await readJsonBody(request, adminPasswordResetCompletionSchema);
    await completeAdminPasswordReset(input);
    return jsonResponse({ completed: true });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
