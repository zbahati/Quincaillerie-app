"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authApi } from "@/lib/api/auth-api";

export function VerifyEmailPage({ token }: { token: string | null }) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    if (!token) {
      setError("This email verification link is missing its token.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await authApi.verifyAdminEmail(token);
      setIsVerified(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Email verification failed.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{isVerified ? "Email verified" : "Verify Admin email"}</CardTitle>
          <CardDescription>
            {isVerified
              ? "Your Admin account is ready. Sign in online to continue."
              : "Confirm this email address to finish setting up Admin access."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          {isVerified ? (
            <Button className="w-full" onClick={() => router.push("/")}>
              Continue to sign in
            </Button>
          ) : (
            <Button className="w-full" onClick={() => void handleVerify()} disabled={isSaving || !token}>
              {isSaving ? "Verifying..." : "Verify email"}
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
