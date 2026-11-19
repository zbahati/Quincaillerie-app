export function RouteIntegrationGate({ routeTitle }: { routeTitle: string }) {
  return (
    <main className="min-h-svh bg-background p-4 sm:p-8">
      <section className="mx-auto mt-[8vh] max-w-2xl rounded-xl border bg-card p-6 shadow-panel sm:p-8">
        <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Quincaillerie Manager
        </p>
        <h1 className="page-title mt-3">{routeTitle}</h1>
        <div
          role="status"
          className="mt-5 rounded-lg border border-border bg-muted/50 p-4 text-sm leading-6"
        >
          <p className="font-semibold">This screen is intentionally gated.</p>
          <p className="mt-1 text-muted-foreground">
            Web authentication is active, but this feature&apos;s server API has
            not been ported yet. The copied screen still depends on Tauri and
            remains gated. No demo user or business data is being shown.
          </p>
        </div>
      </section>
    </main>
  );
}
