import type { MetadataRoute } from "next";
import { appNameServer } from "@/lib/server-config";

// Web app manifest, so the app can be added to a phone's Home Screen and open full screen.
// There is no start_url on purpose: the app then opens at the page it was added from, and
// the iPhone setup page puts the account key in that link (see app/setup/page.tsx). A Home
// Screen web app on iOS has its own storage, so without this it would open signed out.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const name = await appNameServer();
  return {
    name,
    short_name: name,
    description: "Every save becomes a plan.",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
