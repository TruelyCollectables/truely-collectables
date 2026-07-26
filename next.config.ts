import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR;
const tsconfigPath = process.env.NEXT_TSCONFIG_PATH;

const nextConfig: NextConfig = {
  ...(distDir ? { distDir } : {}),
  ...(tsconfigPath ? { typescript: { tsconfigPath } } : {}),
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/account/seller/inventory/instacomp",
          destination: "/api/account/seller/inventory/instacomp-universal",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
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
