import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export type AuthRole = "admin" | "manager";

export interface AuthUser {
  id: string;
  business_id: string;
  username: string;
  full_name: string;
  role: AuthRole;
  branch_id: string | null;
}

export interface AuthSession {
  user: AuthUser;
  permissions: string[];
}

export interface AuthBusinessStatus {
  id: string;
  name: string;
  requires_admin_setup: boolean;
  requires_admin_verification: boolean;
}

export interface AdminBootstrapInput {
  businessId: string | null;
  businessName: string | null;
  username: string;
  fullName: string;
  email: string;
  password: string;
}

export interface SignInInput {
  businessId: string;
  username: string;
  password: string;
}

export interface AdminPasswordResetRequest {
  businessId: string;
  email: string;
}

export interface AdminPasswordResetCompletion {
  token: string;
  newPassword: string;
}

export interface AdminBootstrapResult {
  status: "verification_pending";
  business_id: string;
  email_delivery: "sent" | "failed";
}

function parseUser(value: unknown): AuthUser {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.business_id !== "string" ||
    typeof value.username !== "string" ||
    typeof value.full_name !== "string" ||
    (value.role !== "admin" && value.role !== "manager") ||
    (value.branch_id !== null && typeof value.branch_id !== "string")
  ) {
    throw invalidResponse("The web service returned an invalid user session.");
  }

  return {
    id: value.id,
    business_id: value.business_id,
    username: value.username,
    full_name: value.full_name,
    role: value.role,
    branch_id: value.branch_id,
  };
}

function parseSession(value: unknown): AuthSession {
  if (!isRecord(value) || !Array.isArray(value.permissions)) {
    throw invalidResponse("The web service returned an invalid user session.");
  }
  if (!value.permissions.every((permission) => typeof permission === "string")) {
    throw invalidResponse("The web service returned invalid permissions.");
  }

  return {
    user: parseUser(value.user),
    permissions: value.permissions,
  };
}

function parseBusinessStatuses(value: unknown): AuthBusinessStatus[] {
  if (!isRecord(value) || !Array.isArray(value.businesses)) {
    throw invalidResponse("The web service returned invalid business sign-in options.");
  }

  return value.businesses.map((business) => {
    if (
      !isRecord(business) ||
      typeof business.id !== "string" ||
      typeof business.name !== "string" ||
      typeof business.requires_admin_setup !== "boolean" ||
      typeof business.requires_admin_verification !== "boolean"
    ) {
      throw invalidResponse("The web service returned an invalid business sign-in option.");
    }
    return {
      id: business.id,
      name: business.name,
      requires_admin_setup: business.requires_admin_setup,
      requires_admin_verification: business.requires_admin_verification,
    };
  });
}

function parseBootstrapResult(value: unknown): AdminBootstrapResult {
  if (
    !isRecord(value) ||
    value.status !== "verification_pending" ||
    typeof value.business_id !== "string" ||
    (value.email_delivery !== "sent" && value.email_delivery !== "failed")
  ) {
    throw invalidResponse("The web service returned an invalid Admin setup response.");
  }
  return {
    status: value.status,
    business_id: value.business_id,
    email_delivery: value.email_delivery,
  };
}

function parseNullableSession(value: unknown): AuthSession | null {
  if (!isRecord(value) || !("session" in value)) {
    throw invalidResponse("The web service returned an invalid session response.");
  }
  return value.session === null ? null : parseSession(value.session);
}

function parseSessionResponse(value: unknown): AuthSession {
  if (!isRecord(value) || !("session" in value)) {
    throw invalidResponse("The web service returned an invalid sign-in response.");
  }
  return parseSession(value.session);
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  return requestJson(path, { method: "POST", body: JSON.stringify(body) });
}

export const authApi = {
  async currentSession(): Promise<AuthSession | null> {
    return parseNullableSession(await requestJson("/api/auth/session"));
  },

  async businesses(): Promise<AuthBusinessStatus[]> {
    return parseBusinessStatuses(await requestJson("/api/auth/businesses"));
  },

  async bootstrapAdmin(input: AdminBootstrapInput): Promise<AdminBootstrapResult> {
    return parseBootstrapResult(await postJson("/api/auth/bootstrap", input));
  },

  async signIn(input: SignInInput): Promise<AuthSession> {
    return parseSessionResponse(await postJson("/api/auth/login", input));
  },

  async signOut(): Promise<void> {
    await postJson("/api/auth/logout", {});
  },

  async requestAdminPasswordReset(input: AdminPasswordResetRequest): Promise<void> {
    await postJson("/api/auth/password-reset/request", input);
  },

  async requestAdminEmailVerification(input: AdminPasswordResetRequest): Promise<void> {
    await postJson("/api/auth/verification/request", input);
  },

  async verifyAdminEmail(token: string): Promise<void> {
    await postJson("/api/auth/verify-email", { token });
  },

  async completeAdminPasswordReset(input: AdminPasswordResetCompletion): Promise<void> {
    await postJson("/api/auth/password-reset/complete", input);
  },
};
