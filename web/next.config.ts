import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Disable server-side vendor chunk splitting so all deps are bundled
      // directly into each page's server entry. This prevents the static-paths-worker
      // from failing with MODULE_NOT_FOUND when vendor chunks (e.g. axios) are only
      // in webpack-dev-server memory and not written to disk.
      config.optimization.splitChunks = false;
    }
    return config;
  },
};

export default nextConfig;
