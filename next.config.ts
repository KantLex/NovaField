import type { NextConfig } from "next";
import { MAX_UPLOAD_BYTES } from "./src/lib/limits";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The browser tests run their own server next to the dev one; each needs its own build folder.
  distDir: process.env.NOVAFIELD_DIST_DIR || ".next",
  experimental: {
    // The project lives on an external drive whose file-change events Turbopack sometimes
    // misses; its on-disk dev cache then served stale CSS across restarts. Rebuild from source.
    turbopackFileSystemCacheForDev: false,
    // The proxy (src/proxy.ts) buffers request bodies, by default only the first 10 MB, which cut
    // larger uploads short. It takes them whole up to the app's own limit, and refuses bigger ones.
    proxyClientMaxBodySize: MAX_UPLOAD_BYTES,
  },
  partialPrefetching: true,
  // Dailies was renamed Library and Genjutsu Henshin; old links and bookmarks still land.
  async redirects() {
    return [
      { source: "/dailies", destination: "/library", permanent: true },
      { source: "/genjutsu", destination: "/henshin", permanent: true },
    ];
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
