import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth/authorization";
import type { BusinessSettingsUpdateInput } from "@/lib/server/schemas/business-settings";

import { requirePermission } from "../auth/authorization";
import { AuthServiceError } from "../auth/errors";
import { getDatabasePool } from "../db/pool";
import { withTransaction } from "../db/transaction";
import { recordAuditLog } from "../repositories/audit-logs";
import {
  findBusinessById,
  lockActiveBusinessForAdministration,
  updateBusinessDetails,
} from "../repositories/businesses";

function businessDto(business: NonNullable<Awaited<ReturnType<typeof findBusinessById>>>) {
  return {
    id: business.id,
    name: business.name,
    tax_id: business.taxId,
    currency: business.currency,
    timezone: business.timezone,
    date_format: business.dateFormat,
    language: business.language,
  };
}

export async function getBusinessSettings(context: AuthenticatedContext) {
  requirePermission(context, "business.read");
  const business = await findBusinessById(getDatabasePool(), context.businessId);
  if (!business?.isActive) {
    throw new AuthServiceError(404, "business_not_found", "The business is unavailable.");
  }
  return businessDto(business);
}

export async function updateBusinessSettings(
  context: AuthenticatedContext,
  input: BusinessSettingsUpdateInput,
) {
  requirePermission(context, "business.manage");
  const business = await withTransaction(async (client) => {
    if (!(await lockActiveBusinessForAdministration(client, context.businessId))) {
      throw new AuthServiceError(404, "business_not_found", "The business is unavailable.");
    }
    const updated = await updateBusinessDetails(client, context.businessId, input);
    await recordAuditLog(client, {
      businessId: context.businessId,
      userId: context.userId,
      action: "business.details_updated",
      entityType: "business",
      entityId: context.businessId,
      details: { name: updated.name, tax_id: updated.taxId },
    });
    return updated;
  });
  return businessDto(business);
}
