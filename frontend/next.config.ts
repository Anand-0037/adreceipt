import type { NextConfig } from "next";
import path from "node:path";

const apiOrigin =
  process.env.ADRECEIPT_API_ORIGIN?.replace(/\/$/, "") ??
  (process.env.ADRECEIPT_API_HOSTPORT
    ? `http://${process.env.ADRECEIPT_API_HOSTPORT}`
    : "http://localhost:8787");

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
