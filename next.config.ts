import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/large server-only packages: load from node_modules at runtime instead of bundling.
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "googleapis"],
  cacheComponents: true,
  partialPrefetching: true,
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
