import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { adminEmailVerificationSchema } from "@/lib/server/schemas/identity";
import { verifyAdminEmail } from "@/lib/server/services/auth";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const input = await readJsonBody(request, adminEmailVerificationSchema);
    await verifyAdminEmail(input.token);
    return jsonResponse({ verified: true });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
