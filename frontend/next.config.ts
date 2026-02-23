import type { NextConfig } from "next";

const DEFAULT_BACKEND_URL =
  process.env.NODE_ENV === "development"
    ? "http://localhost:8000"
    : "https://project-pbe-production.up.railway.app:8080";

const BACKEND_URL = process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "raw.communitydragon.org" },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
