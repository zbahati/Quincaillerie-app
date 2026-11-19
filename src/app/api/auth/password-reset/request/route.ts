import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { adminPasswordResetRequestSchema } from "@/lib/server/schemas/identity";
import { requestAdminPasswordReset } from "@/lib/server/services/auth";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const input = await readJsonBody(request, adminPasswordResetRequestSchema);
    await requestAdminPasswordReset(input);
    return jsonResponse({ status: "accepted" }, 202);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
