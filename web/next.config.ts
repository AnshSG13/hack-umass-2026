import type { NextConfig } from "next";

// The browser only ever talks to this origin. /api/* is proxied to the FastAPI
// server: API_INTERNAL_URL in Docker, localhost:8000 in local dev.
const API = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  // The dev-only route badge sits on top of the bottom tab bar; hide it.
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
