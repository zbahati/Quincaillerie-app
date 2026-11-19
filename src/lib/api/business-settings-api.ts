import { ApiError, invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface BusinessSettings {
  id: string;
  name: string;
  tax_id: string | null;
  currency: string;
  timezone: string;
  date_format: string;
  language: string;
}

export interface BusinessSettingsResult {
  business: BusinessSettings;
  canManage: boolean;
}

function parseBusiness(value: unknown): BusinessSettings {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    (value.tax_id !== null && typeof value.tax_id !== "string") ||
    typeof value.currency !== "string" ||
    typeof value.timezone !== "string" ||
    typeof value.date_format !== "string" ||
    typeof value.language !== "string"
  ) {
    throw invalidResponse("The service returned invalid business settings.");
  }
  return {
    id: value.id,
    name: value.name,
    tax_id: value.tax_id,
    currency: value.currency,
    timezone: value.timezone,
    date_format: value.date_format,
    language: value.language,
  };
}

function parseResult(value: unknown): BusinessSettingsResult {
  if (
    !isRecord(value) ||
    !("business" in value) ||
    typeof value.canManage !== "boolean"
  ) {
    throw invalidResponse("The service returned invalid business settings.");
  }
  return { business: parseBusiness(value.business), canManage: value.canManage };
}

export const businessSettingsApi = {
  async get(): Promise<BusinessSettingsResult> {
    return parseResult(await requestJson("/api/settings/business"));
  },

  async update(input: { name: string; taxId: string | null }): Promise<BusinessSettings> {
    const response = await requestJson("/api/settings/business", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    if (!isRecord(response) || !("business" in response)) {
      throw invalidResponse("The service returned invalid business settings.");
    }
    return parseBusiness(response.business);
  },

  async downloadExport(): Promise<void> {
    let response: Response;
    try {
      response = await fetch("/api/settings/business/export", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
    } catch (cause) {
      throw new ApiError("Could not reach the web service.", 0, "network_error", { cause });
    }

    if (!response.ok) {
      let message = `Request failed with status ${response.status}.`;
      let code = "http_error";
      try {
        const payload: unknown = await response.json();
        if (isRecord(payload) && isRecord(payload.error)) {
          if (typeof payload.error.message === "string") message = payload.error.message;
          if (typeof payload.error.code === "string") code = payload.error.code;
        }
      } catch {
        throw new ApiError(message, response.status, code);
      }
      throw new ApiError(message, response.status, code);
    }

    const blob = await response.blob();
    const fileName = response.headers
      .get("content-disposition")
      ?.match(/filename="([^"]+)"/i)?.[1] ?? "quincaillerie-business-export.json";
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  },
};
