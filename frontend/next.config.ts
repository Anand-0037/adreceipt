import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Client protocol configuration imports the repository deployment record.
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
