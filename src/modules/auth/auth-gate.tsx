"use client";

import { ArrowLeft, Building2, KeyRound, LoaderCircle, LogIn, UserRoundPlus } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/shared/select-field";
import { authApi, type AuthBusinessStatus, type AuthSession, type AuthUser } from "@/lib/api/auth-api";

interface AuthContextValue {
  user: AuthUser;
  permissions: string[];
  logout: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : "An unexpected error occurred.";
}

function applySession(session: AuthSession, setUser: (user: AuthUser) => void, setPermissions: (permissions: string[]) => void) {
  setUser(session.user);
  setPermissions(session.permissions);
}

export function useAuthentication(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("Authentication context is only available to signed-in application screens.");
  }
  return context;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [businesses, setBusinesses] = useState<AuthBusinessStatus[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [isRecovery, setIsRecovery] = useState(false);
  const [pendingBusinessId, setPendingBusinessId] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function restoreAuthentication() {
      try {
        const session = await authApi.currentSession();
        if (session) {
          if (active) {
            applySession(session, setUser, setPermissions);
            setIsReady(true);
          }
          return;
        }

        const result = await authApi.businesses();
        if (active) {
          setBusinesses(result);
          setBusinessId(result[0]?.id ?? "");
          setIsReady(true);
        }
      } catch (cause) {
        if (active) {
          setError(`Could not load web sign-in information. ${errorText(cause)}`);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void restoreAuthentication();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const selectedBusiness = businesses.find((business) => business.id === businessId);
  const isInitialBusinessSetup = businesses.length === 0;
  const requiresAdminSetup = isInitialBusinessSetup || selectedBusiness?.requires_admin_setup === true;
  const isPendingVerification =
    pendingBusinessId === businessId ||
    selectedBusiness?.requires_admin_verification === true;
  const isBootstrap = requiresAdminSetup && !isPendingVerification;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (isRecovery) {
      setIsSaving(true);
      try {
        await authApi.requestAdminPasswordReset({ businessId, email: email.trim() });
        setSuccess("If an Admin account matches this business and email, password reset instructions will be sent.");
      } catch (cause) {
        setError(`Could not request password recovery. ${errorText(cause)}`);
      } finally {
        setIsSaving(false);
      }
      return;
    }

    if (isPendingVerification) {
      setIsSaving(true);
      try {
        if (bootstrapSecret.trim()) {
          await authApi.requestAdminEmailVerification({
            businessId,
            email: email.trim(),
            setupSecret: bootstrapSecret,
          });
          setBusinesses((current) =>
            current.map((business) =>
              business.id === businessId
                ? { ...business, requires_admin_verification: false }
                : business,
            ),
          );
          setPendingBusinessId(null);
          setBootstrapSecret("");
          setSuccess("Admin verification is complete. Sign in with your Admin username and password.");
        } else {
          await authApi.requestAdminEmailVerification({ businessId, email: email.trim() });
          setSuccess("If an unverified Admin account matches this business and email, a verification link will be sent.");
        }
      } catch (cause) {
        setError(
          bootstrapSecret.trim()
            ? `Could not verify the Admin setup code. ${errorText(cause)}`
            : `Could not request an email verification link. ${errorText(cause)}`,
        );
      } finally {
        setIsSaving(false);
      }
      return;
    }

    if (isBootstrap && password !== passwordConfirmation) {
      setError("The password confirmation does not match.");
      return;
    }

    setIsSaving(true);
    try {
      if (isBootstrap) {
        const result = await authApi.bootstrapAdmin({
          businessId: isInitialBusinessSetup ? null : businessId,
          businessName: isInitialBusinessSetup ? businessName.trim() : null,
          username: username.trim(),
          fullName: fullName.trim(),
          email: email.trim(),
          password,
        });
        setBusinessId(result.business_id);
        setPendingBusinessId(result.business_id);
        setBusinesses((current) => {
          const knownBusiness = current.some((business) => business.id === result.business_id);
          if (knownBusiness) {
            return current.map((business) =>
              business.id === result.business_id
                ? { ...business, requires_admin_setup: false, requires_admin_verification: true }
                : business,
            );
          }
          return [
            ...current,
            {
              id: result.business_id,
              name: businessName.trim(),
              requires_admin_setup: false,
              requires_admin_verification: true,
            },
          ];
        });
        setSuccess(
          result.email_delivery === "sent"
            ? "Admin account created. Check your email and verify the address before signing in."
            : "Admin account created, but the verification email could not be delivered. Use the temporary setup code below or configure email delivery.",
        );
        setPassword("");
        setPasswordConfirmation("");
      } else {
        const session = await authApi.signIn({
          businessId,
          username: username.trim(),
          password,
        });
        applySession(session, setUser, setPermissions);
        setPassword("");
      }
    } catch (cause) {
      setError(
        isBootstrap
          ? `Could not create the Admin account. ${errorText(cause)}`
          : `Sign-in failed. ${errorText(cause)}`,
      );
    } finally {
      setIsSaving(false);
    }
  }

  const logout = useCallback(async () => {
    try {
      await authApi.signOut();
      setUser(null);
      setPermissions([]);
      setPassword("");
      setPasswordConfirmation("");
      setError(null);
      setIsLoading(true);
      setIsReady(false);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setError(`Could not sign out. ${errorText(cause)}`);
    }
  }, []);

  const contextValue = useMemo(
    () => (user ? { user, permissions, logout, error } : null),
    [user, permissions, logout, error],
  );

  if (user && contextValue) {
    return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      {isLoading ? (
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Checking secure web sign-in...
          </CardContent>
        </Card>
      ) : !isReady ? (
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Web sign-in is unavailable</CardTitle>
            <CardDescription>The server could not confirm the current session or business setup.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setError(null);
                setIsLoading(true);
                setReloadKey((key) => key + 1);
              }}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {isRecovery || isPendingVerification ? <KeyRound className="size-5" /> : isBootstrap ? <UserRoundPlus className="size-5" /> : <KeyRound className="size-5" />}
            </div>
            <div className="space-y-1">
              <CardTitle>
                {isRecovery
                  ? "Recover Admin access"
                  : isPendingVerification
                    ? "Verify Admin email"
                    : isBootstrap
                      ? "Set up Admin access"
                      : "Sign in to your business"}
              </CardTitle>
              <CardDescription>
                {isRecovery
                  ? "Enter the Admin email address. If it matches this business, reset instructions will be sent by email."
                  : isPendingVerification
                    ? "Verify the Admin email before signing in. Check your inbox, request another link, or use the temporary setup code."
                    : isBootstrap
                      ? "Create the first Admin account. Sign-in and initial setup require an internet connection."
                      : "Business Admins and active Managers can sign in with their business username and password."}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {error ? (
              <div role="alert" className="mb-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}
            {success ? (
              <div role="status" className="mb-5 rounded-md border border-border bg-muted/50 p-3 text-sm">
                {success}
              </div>
            ) : null}
            <form className="space-y-4" onSubmit={handleSubmit}>
              {isInitialBusinessSetup && isBootstrap && !isRecovery ? (
                <div className="space-y-2">
                  <Label htmlFor="auth-business-name">Business name</Label>
                  <Input
                    id="auth-business-name"
                    autoComplete="organization"
                    maxLength={120}
                    required
                    value={businessName}
                    onChange={(event) => setBusinessName(event.target.value)}
                  />
                </div>
              ) : !isInitialBusinessSetup ? (
                <div className="space-y-2">
                  <Label htmlFor="auth-business">Business</Label>
                  <SelectField
                    id="auth-business"
                    value={businessId}
                    onChange={(event) => {
                      const selectedId = event.target.value;
                      setBusinessId(selectedId);
                      setBootstrapSecret("");
                      const selected = businesses.find((business) => business.id === selectedId);
                      if (selected?.requires_admin_setup) {
                        setUsername("admin");
                        setFullName("Administrator");
                      } else {
                        setUsername("");
                        setFullName("");
                      }
                    }}
                    required
                  >
                    {businesses.map((business) => (
                      <option key={business.id} value={business.id}>{business.name}</option>
                    ))}
                  </SelectField>
                </div>
              ) : null}
              {!isRecovery && isBootstrap ? (
                <div className="space-y-2">
                  <Label htmlFor="auth-full-name">Admin full name</Label>
                  <Input id="auth-full-name" autoComplete="name" maxLength={120} required value={fullName} onChange={(event) => setFullName(event.target.value)} />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor={isRecovery || isBootstrap || isPendingVerification ? "auth-email" : "auth-username"}>
                  {isRecovery || isBootstrap || isPendingVerification ? "Admin email" : "Username"}
                </Label>
                {isRecovery || isBootstrap || isPendingVerification ? (
                  <Input
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                ) : (
                  <>
                    <Input
                      id="auth-username"
                      autoComplete="username"
                      minLength={3}
                      maxLength={32}
                      required
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                    />
                  </>
                )}
              </div>
              {isPendingVerification ? (
                <div className="space-y-2">
                  <Label htmlFor="auth-bootstrap-secret">Temporary Admin setup code</Label>
                  <Input
                    id="auth-bootstrap-secret"
                    type="password"
                    autoComplete="off"
                    maxLength={256}
                    value={bootstrapSecret}
                    onChange={(event) => setBootstrapSecret(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use this only for the initial Admin setup. Remove the code from Render after verification.
                  </p>
                </div>
              ) : null}
              {!isRecovery && isBootstrap ? (
                <div className="space-y-2">
                  <Label htmlFor="auth-username">Admin username</Label>
                  <Input id="auth-username" autoComplete="username" minLength={3} maxLength={32} required value={username} onChange={(event) => setUsername(event.target.value)} />
                  <p className="text-xs text-muted-foreground">The default username is admin; you can change it before creating the account.</p>
                </div>
              ) : null}
              {!isRecovery && !isPendingVerification ? (
                <div className="space-y-2">
                  <Label htmlFor="auth-password">Password</Label>
                  <Input
                    id="auth-password"
                    type="password"
                    autoComplete={isBootstrap ? "new-password" : "current-password"}
                    minLength={isBootstrap ? 12 : undefined}
                    maxLength={128}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  {isBootstrap ? <p className="text-xs text-muted-foreground">Use at least 12 characters.</p> : null}
                </div>
              ) : null}
              {isBootstrap && !isRecovery ? (
                <div className="space-y-2">
                  <Label htmlFor="auth-password-confirmation">Confirm password</Label>
                  <Input id="auth-password-confirmation" type="password" minLength={12} maxLength={128} required value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} />
                </div>
              ) : null}
              <Button className="w-full" type="submit" disabled={isSaving || (!businessId && !isInitialBusinessSetup)}>
                {isSaving ? <LoaderCircle className="animate-spin" /> : isRecovery || isPendingVerification ? <KeyRound /> : isBootstrap ? <Building2 /> : <LogIn />}
                {isSaving
                  ? "Please wait..."
                  : isRecovery
                    ? "Send recovery email"
                    : isPendingVerification
                      ? bootstrapSecret.trim()
                        ? "Verify with setup code"
                        : "Resend verification email"
                      : isBootstrap
                        ? "Create Admin account"
                        : "Sign in"}
              </Button>
            </form>
            {!requiresAdminSetup && !isPendingVerification && !isRecovery ? (
              <Button variant="link" className="mt-3 w-full" type="button" onClick={() => { setIsRecovery(true); setSuccess(null); setError(null); }}>
                Forgot Admin password?
              </Button>
            ) : null}
            {isRecovery ? (
              <Button variant="ghost" className="mt-2 w-full" type="button" onClick={() => { setIsRecovery(false); setSuccess(null); setError(null); }}>
                <ArrowLeft />Back to sign in
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
