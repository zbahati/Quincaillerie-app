import {
  handleAuthRouteError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
  setSessionCookie,
} from "@/lib/server/auth/http";
import { signInSchema } from "@/lib/server/schemas/identity";
import { signIn } from "@/lib/server/services/auth";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const input = await readJsonBody(request, signInSchema);
    const result = await signIn(input);
    const response = jsonResponse({ session: result.session });
    setSessionCookie(response, result.sessionToken);
    return response;
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
