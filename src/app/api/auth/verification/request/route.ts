import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { adminEmailVerificationRequestSchema } from "@/lib/server/schemas/identity";
import {
  requestAdminEmailVerification,
  verifyPendingAdminWithSetupSecret,
} from "@/lib/server/services/auth";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const input = await readJsonBody(request, adminEmailVerificationRequestSchema);
    if (input.setupSecret !== undefined) {
      await verifyPendingAdminWithSetupSecret({
        businessId: input.businessId,
        email: input.email,
        setupSecret: input.setupSecret,
      });
      return jsonResponse({ status: "verified" });
    }
    await requestAdminEmailVerification(input.businessId, input.email);
    return jsonResponse({ status: "accepted" }, 202);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
