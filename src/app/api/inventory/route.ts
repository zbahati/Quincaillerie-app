import {
  authenticatedContext,
  handleAuthRouteError,
  inventoryPageDto,
} from "./_shared";
import {
  jsonResponse,
} from "@/lib/server/auth/http";
import { AuthServiceError } from "@/lib/server/auth/errors";
import { inventoryListQuerySchema } from "@/lib/server/schemas/inventory";
import { listBusinessInventory } from "@/lib/server/services/inventory";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedContext(request);
    const parsedQuery = inventoryListQuerySchema.safeParse({
      branchId: request.nextUrl.searchParams.get("branchId") ?? undefined,
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success) {
      throw new AuthServiceError(
        400,
        "invalid_input",
        parsedQuery.error.issues[0]?.message ?? "The inventory query is invalid.",
      );
    }
    return jsonResponse(inventoryPageDto(await listBusinessInventory(context, parsedQuery.data)));
  } catch (cause) {
    return handleAuthRouteError(cause);
  }
}
