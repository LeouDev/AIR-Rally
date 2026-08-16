"use client";

import dynamic from "next/dynamic";
import { MapPlaceholder } from "@/components/search/MapPlaceholder";

/**
 * Leaflet touches `window`/`navigator` as soon as a map actually
 * initializes, so this must never render on the server — `ssr: false`
 * is the standard fix for react-leaflet under Next.js. This version of
 * Next.js requires the `dynamic(..., { ssr: false })` call itself to
 * live inside a Client Component file (a Server Component calling it
 * directly is a build error) — the two pages that use this still import
 * and render it as plain JSX, same as any other Client Component.
 */
export const VenueMapLoader = dynamic(() => import("@/components/search/VenueMap").then((mod) => mod.VenueMap), {
  ssr: false,
  loading: () => <MapPlaceholder className="h-64 lg:h-full" />,
});
