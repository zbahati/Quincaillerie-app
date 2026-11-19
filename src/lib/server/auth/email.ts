import "server-only";

import { AuthServiceError } from "./errors";

interface AuthEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function getEmailConfiguration(): { apiKey: string; from: string; baseUrl: URL } {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const baseUrlValue = process.env.WEB_BASE_URL;
  if (!apiKey || !from || !baseUrlValue) {
    throw new AuthServiceError(
      503,
      "email_not_configured",
      "Email delivery is not configured. Contact the application administrator.",
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlValue);
  } catch {
    throw new AuthServiceError(
      503,
      "email_not_configured",
      "The application URL is not configured correctly.",
    );
  }

  if (
    (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new AuthServiceError(
      503,
      "email_not_configured",
      "The application URL is not configured correctly.",
    );
  }

  return { apiKey, from, baseUrl };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildVerificationLink(token: string): string {
  const { baseUrl } = getEmailConfiguration();
  const link = new URL("/verify-email", baseUrl);
  link.searchParams.set("token", token);
  return link.toString();
}

export function buildPasswordResetLink(token: string): string {
  const { baseUrl } = getEmailConfiguration();
  const link = new URL("/password-reset", baseUrl);
  link.searchParams.set("token", token);
  return link.toString();
}

export async function sendAuthEmail(email: AuthEmail): Promise<void> {
  const { apiKey, from } = getEmailConfiguration();
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AuthServiceError(
      503,
      "email_delivery_failed",
      "The email service could not be reached.",
    );
  }

  if (!response.ok) {
    throw new AuthServiceError(
      503,
      "email_delivery_failed",
      "The email service could not deliver the message.",
    );
  }
}

export function verificationEmail(
  fullName: string,
  token: string,
): AuthEmail {
  const link = buildVerificationLink(token);
  const safeName = escapeHtml(fullName);
  return {
    to: "",
    subject: "Verify your Quincaillerie Manager Admin email",
    text: `Hello ${fullName},\n\nVerify your Admin email by opening this link:\n${link}\n\nThis link expires in 24 hours. If you did not create this account, ignore this email.`,
    html: `<p>Hello ${safeName},</p><p>Verify your Admin email by opening this link:</p><p><a href="${escapeHtml(link)}">Verify email</a></p><p>This link expires in 24 hours. If you did not create this account, ignore this email.</p>`,
  };
}

export function passwordResetEmail(
  fullName: string,
  token: string,
): AuthEmail {
  const link = buildPasswordResetLink(token);
  const safeName = escapeHtml(fullName);
  return {
    to: "",
    subject: "Reset your Quincaillerie Manager Admin password",
    text: `Hello ${fullName},\n\nReset your Admin password by opening this link:\n${link}\n\nThis link expires in 30 minutes. If you did not request a reset, ignore this email.`,
    html: `<p>Hello ${safeName},</p><p>Reset your Admin password by opening this link:</p><p><a href="${escapeHtml(link)}">Reset password</a></p><p>This link expires in 30 minutes. If you did not request a reset, ignore this email.</p>`,
  };
}

export async function deliverVerificationEmail(
  email: string,
  fullName: string,
  token: string,
): Promise<void> {
  await sendAuthEmail({ ...verificationEmail(fullName, token), to: email });
}

export async function deliverPasswordResetEmail(
  email: string,
  fullName: string,
  token: string,
): Promise<void> {
  await sendAuthEmail({ ...passwordResetEmail(fullName, token), to: email });
}

export function getConfiguredWebOrigin(): string {
  const value = process.env.WEB_BASE_URL;
  if (!value) {
    throw new AuthServiceError(
      500,
      "server_misconfigured",
      "The authentication service is not configured.",
    );
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid application origin.");
    }
    return url.origin;
  } catch {
    throw new AuthServiceError(
      500,
      "server_misconfigured",
      "The authentication service is not configured.",
    );
  }
}
