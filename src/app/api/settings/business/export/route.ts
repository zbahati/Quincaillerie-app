import { findAuthenticatedContext } from "@/lib/server/auth/authorization";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { handleAuthRouteError, requestSessionToken } from "@/lib/server/auth/http";
import { createBusinessDataExport } from "@/lib/server/services/business-export";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await findAuthenticatedContext(requestSessionToken(request));
    if (!context) {
      throw new AuthServiceError(401, "authentication_required", "Sign in to continue.");
    }

    const download = await createBusinessDataExport(context);
    return new Response(download.body, {
      headers: {
        "Cache-Control": "no-store, private",
        "Content-Disposition": `attachment; filename="${download.fileName}"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
