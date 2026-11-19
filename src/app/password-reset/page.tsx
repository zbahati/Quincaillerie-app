import { Suspense } from "react";

import { PasswordResetPage } from "@/modules/auth/password-reset-page";

async function PasswordResetContent({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;
  return <PasswordResetPage token={token} />;
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<main className="min-h-svh bg-muted/30" aria-busy="true" />}>
      <PasswordResetContent searchParams={searchParams} />
    </Suspense>
  );
}
