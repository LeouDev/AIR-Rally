import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
