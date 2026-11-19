"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { PwaProvider } from "./pwa-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <PwaProvider>
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
    </PwaProvider>
  );
}
