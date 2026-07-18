import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR;
const tsconfigPath = process.env.NEXT_TSCONFIG_PATH;

const nextConfig: NextConfig = {
  ...(distDir ? { distDir } : {}),
  ...(tsconfigPath ? { typescript: { tsconfigPath } } : {}),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
