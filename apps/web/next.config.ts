import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    MOSAIC_API_URL: process.env.MOSAIC_API_URL ?? "",
  },
};

export default nextConfig;
