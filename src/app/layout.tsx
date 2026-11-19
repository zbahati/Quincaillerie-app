import type { Metadata, Viewport } from "next";
import { AuthBoundary } from "./auth-boundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quincaillerie Manager",
  description: "Inventory and business management.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Quincaillerie",
  },
};

export const viewport: Viewport = {
  themeColor: "#1e3a5f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <AuthBoundary>{children}</AuthBoundary>
      </body>
    </html>
  );
}
