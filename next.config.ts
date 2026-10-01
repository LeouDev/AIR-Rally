import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Framework fingerprinting is free reconnaissance for an attacker —
  // no functional value to leaving it on, one line to turn off.
  poweredByHeader: false,
  // Open Match notifications link to /ranked/open/<id>, which the app opens
  // on its Play tab but the website has no page for — so the same link in an
  // email or the web bell was a 404. Temporary, in case the web gets one.
  async redirects() {
    return [{ source: "/ranked/open/:id", destination: "/ranked/new", permanent: false }];
  },
  images: {
    remotePatterns: [
      {
        // Supabase Storage public object URLs — the `venue-images` bucket
        // (see supabase/migrations/20260809000009_venue_images_storage.sql).
        // No upload UI exists yet, so nothing serves from this today, but
        // ImageGallery's real-photo path needs Next's image optimizer to
        // trust the host ahead of that.
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
