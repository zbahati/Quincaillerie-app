export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    status: number,
    code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function requestJson(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && init.body !== null) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers,
    });
  } catch (cause) {
    throw new ApiError("Could not reach the web service.", 0, "network_error", {
      cause,
    });
  }

  if (response.status === 204) {
    if (!response.ok) {
      throw new ApiError(`Request failed with status ${response.status}.`, response.status, "http_error");
    }
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new ApiError(
      response.ok
        ? "The web service returned an invalid response."
        : `Request failed with status ${response.status}.`,
      response.status,
      response.ok ? "invalid_response" : "http_error",
      { cause },
    );
  }

  if (!response.ok) {
    const body = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const code = typeof body?.code === "string" ? body.code : "http_error";
    const message =
      typeof body?.message === "string"
        ? body.message
        : `Request failed with status ${response.status}.`;
    throw new ApiError(message, response.status, code);
  }

  return payload;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function invalidResponse(message: string): ApiError {
  return new ApiError(message, 502, "invalid_response");
}
