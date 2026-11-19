import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Quincaillerie Manager",
    short_name: "Quincaillerie",
    description: "Inventory and business management.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f1f4f8",
    theme_color: "#1e3a5f",
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
