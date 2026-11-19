"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { AppLayout } from "@/app/layouts/app-layout";
import { AppProviders } from "@/app/providers/app-providers";
import { AuthGate } from "@/modules/auth/auth-gate";

const PUBLIC_AUTH_PATHS = new Set(["/verify-email", "/password-reset"]);

function AuthBoundaryContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (PUBLIC_AUTH_PATHS.has(pathname)) {
    return children;
  }
  return (
    <AuthGate>
      <AppProviders>
        <AppLayout>{children}</AppLayout>
      </AppProviders>
    </AuthGate>
  );
}

export function AuthBoundary({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<main className="min-h-svh bg-muted/30" aria-busy="true" />}>
      <AuthBoundaryContent>{children}</AuthBoundaryContent>
    </Suspense>
  );
}
