import { Suspense } from "react";

import { VerifyEmailPage } from "@/modules/auth/verify-email-page";

async function VerifyEmailContent({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;
  return <VerifyEmailPage token={token} />;
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<main className="min-h-svh bg-muted/30" aria-busy="true" />}>
      <VerifyEmailContent searchParams={searchParams} />
    </Suspense>
  );
}
