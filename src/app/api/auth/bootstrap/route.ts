import { adminBootstrapSchema } from "@/lib/server/schemas/identity";
import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/auth/http";
import { bootstrapAdmin } from "@/lib/server/services/auth";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const input = await readJsonBody(request, adminBootstrapSchema);
    return jsonResponse(await bootstrapAdmin(input), 202);
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
