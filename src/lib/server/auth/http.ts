import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";

import { authSessionCookieName, AUTH_SESSION_MAX_AGE_SECONDS } from "./crypto";
import { getConfiguredWebOrigin } from "./email";
import { AuthServiceError } from "./errors";

const MAX_AUTH_REQUEST_BYTES = 16 * 1024;

export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): NextResponse {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store, private");
  return NextResponse.json(body, { status, headers: responseHeaders });
}

export function emptyResponse(status = 204, headers?: HeadersInit): NextResponse {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store, private");
  return new NextResponse(null, { status, headers: responseHeaders });
}

export function requireSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new AuthServiceError(403, "invalid_origin", "This request is not allowed.");
  }

  let actualOrigin: string;
  try {
    actualOrigin = new URL(origin).origin;
  } catch {
    throw new AuthServiceError(403, "invalid_origin", "This request is not allowed.");
  }
  if (origin !== actualOrigin || actualOrigin !== getConfiguredWebOrigin()) {
    throw new AuthServiceError(403, "invalid_origin", "This request is not allowed.");
  }
}

export async function readJsonBody<T>(
  request: NextRequest,
  schema: ZodType<T>,
): Promise<T> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_AUTH_REQUEST_BYTES) {
    throw new AuthServiceError(413, "request_too_large", "The request is too large.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AuthServiceError(400, "invalid_json", "The request body must be valid JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AuthServiceError(
      400,
      "invalid_input",
      parsed.error.issues[0]?.message ?? "The request is invalid.",
    );
  }
  return parsed.data;
}

export function requestSessionToken(request: NextRequest): string | null {
  return request.cookies.get(authSessionCookieName())?.value ?? null;
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(authSessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(authSessionCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function handleAuthRouteError(cause: unknown): NextResponse {
  if (cause instanceof AuthServiceError) {
    const headers =
      cause.retryAfterSeconds === undefined
        ? undefined
        : { "Retry-After": String(cause.retryAfterSeconds) };
    return jsonResponse(
      { error: { code: cause.code, message: cause.message } },
      cause.status,
      headers,
    );
  }

  console.error(
    "Unhandled API route error.",
    cause instanceof Error ? cause.name : "UnknownError",
  );
  return jsonResponse(
    {
      error: {
        code: "internal_error",
        message: "The authentication service could not complete the request.",
      },
    },
    500,
  );
}
