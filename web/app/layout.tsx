import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

// Archivo as a variable font with the width axis, so "wdth 125" works (DESIGN.md section 3).
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

// The real name comes from GET /api/config at runtime; this is only the static tab title.
export const metadata: Metadata = {
  title: "Realize",
  description: "Every save becomes a plan.",
};

export const viewport: Viewport = {
  themeColor: "#F3F5F7",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
