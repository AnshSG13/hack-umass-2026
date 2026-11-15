import type { Metadata, Viewport } from "next";
import { Figtree, Hedvig_Letters_Serif } from "next/font/google";
import { Sprite } from "@/components/icons";
import { Providers } from "@/components/providers";
import { appNameServer } from "@/lib/server-config";
import "./globals.css";
import "./mock.css";
import "./v2.css";
import "./story.css";

// The mockup's two faces: Hedvig Letters Serif for headings, Figtree for everything else.
const hedvig = Hedvig_Letters_Serif({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-hedvig",
  display: "swap",
});
const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

// The name comes from GET /api/config. The Apple tags make "Add to Home Screen" on an
// iPhone open the app full screen with its own icon and name.
export async function generateMetadata(): Promise<Metadata> {
  const name = await appNameServer();
  return {
    title: name,
    description: "Every save becomes a plan.",
    applicationName: name,
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
    icons: {
      icon: [
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    formatDetection: { telephone: false },
    // Next writes the newer "mobile-web-app-capable" tag; older iOS only reads this one.
    other: { "apple-mobile-web-app-capable": "yes" },
  };
}

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${hedvig.variable} ${figtree.variable} h-full`}>
      <body className="min-h-full">
        <Sprite />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
