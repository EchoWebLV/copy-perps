import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // PostHog reverse proxy. Routes /ingest/* to PostHog's US ingest so
  // ad blockers (uBlock, Brave shields, etc.) can't blacklist our
  // analytics calls. skipTrailingSlashRedirect is required for the
  // /decide endpoint specifically.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
      {
        source: "/ingest/decide",
        destination: "https://us.i.posthog.com/decide",
      },
    ];
  },
};

export default nextConfig;
