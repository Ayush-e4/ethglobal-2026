import { APP } from "@app/shared";
import type { MetadataRoute } from "next";

/** Shikigami as an installable app (Add to Home Screen): its own window, icon and shortcuts. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP.name,
    short_name: APP.name,
    description: APP.tagline,
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["finance", "productivity", "travel"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New chat", url: "/chat", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Trips", url: "/trips", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Wallet", url: "/wallet", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
