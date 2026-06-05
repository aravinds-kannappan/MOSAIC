const nextConfig = {
  reactStrictMode: true,
  env: {
    MOSAIC_API_URL: process.env.MOSAIC_API_URL ?? "",
  },
};

module.exports = nextConfig;
