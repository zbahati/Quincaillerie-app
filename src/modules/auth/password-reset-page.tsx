"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi } from "@/lib/api/auth-api";

export function PasswordResetPage({ token }: { token: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError("This password reset link is missing its token.");
      return;
    }
    if (password !== confirmation) {
      setError("The password confirmation does not match.");
      return;
    }

    setIsSaving(true);
    try {
      await authApi.completeAdminPasswordReset({ token, newPassword: password });
      setPassword("");
      setConfirmation("");
      setIsComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password reset failed.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{isComplete ? "Password updated" : "Reset Admin password"}</CardTitle>
          <CardDescription>
            {isComplete
              ? "Your other signed-in sessions have been revoked. Sign in again with your new password."
              : "Choose a new password with at least 12 characters."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          {isComplete ? (
            <Button className="w-full" onClick={() => router.push("/")}>
              Continue to sign in
            </Button>
          ) : (
            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <div className="space-y-2">
                <Label htmlFor="reset-password">New password</Label>
                <Input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-password-confirmation">Confirm new password</Label>
                <Input
                  id="reset-password-confirmation"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </div>
              <Button className="w-full" type="submit" disabled={isSaving || !token}>
                {isSaving ? "Saving..." : "Update password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
