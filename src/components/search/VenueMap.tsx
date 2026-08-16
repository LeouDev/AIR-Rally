"use client";

import { useEffect } from "react";
import Link from "next/link";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { MapPlaceholder } from "@/components/search/MapPlaceholder";

// Leaflet's default marker icon references relative image paths meant for
// a plain <img src>, which this project's bundler doesn't rewrite when
// the PNGs are imported straight from node_modules/leaflet/dist/images
// (confirmed live: the imported modules had no usable .src, and every
// marker/shadow <img> ended up pointing at "/undefined"). Pointing at
// unpkg's CDN copy of the exact installed leaflet version sidesteps that
// bundler-specific asset-resolution gap entirely — same "no self-hosted
// map asset" posture this whole component already takes for OSM tiles.
const LEAFLET_VERSION = "1.9.4";
L.Icon.Default.mergeOptions({
  iconRetinaUrl: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/images/marker-icon-2x.png`,
  iconUrl: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/images/marker-icon.png`,
  shadowUrl: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/images/marker-shadow.png`,
});

export type VenueMapMarker = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  href: string;
  price: number | null;
};

const DEFAULT_CENTER: [number, number] = [10.3157, 123.8854]; // Cebu City — every current venue is Philippines-based
const DEFAULT_ZOOM = 12;

function FitToMarkers({ markers }: { markers: VenueMapMarker[] }) {
  const map = useMap();
  useEffect(() => {
    if (markers.length === 0) return;
    if (markers.length === 1) {
      map.setView([markers[0].lat, markers[0].lng], DEFAULT_ZOOM);
      return;
    }
    const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [32, 32] });
    // Only re-fit when the actual set of marker coordinates changes, not
    // on every render — `map` itself is stable across the component's
    // lifetime (react-leaflet guarantees one instance per MapContainer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers.map((m) => `${m.id}:${m.lat}:${m.lng}`).join("|")]);
  return null;
}

type VenueMapProps = {
  markers: VenueMapMarker[];
  className?: string;
  resultCount?: number;
};

/**
 * OpenStreetMap tiles via react-leaflet — free, no API key, matching
 * lib/services/maps.ts's original design goal. Falls back to the static
 * MapPlaceholder when there's nothing geocoded to show yet, same as
 * before this component existed, rather than rendering an empty map.
 */
export function VenueMap({ markers, className, resultCount }: VenueMapProps) {
  const validMarkers = markers.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));

  if (validMarkers.length === 0) {
    return <MapPlaceholder className={className} resultCount={resultCount} />;
  }

  const initialCenter: [number, number] =
    validMarkers.length === 1 ? [validMarkers[0].lat, validMarkers[0].lng] : DEFAULT_CENTER;

  return (
    <MapContainer
      center={initialCenter}
      zoom={DEFAULT_ZOOM}
      scrollWheelZoom={false}
      className={className}
      style={{ borderRadius: "1rem" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToMarkers markers={validMarkers} />
      {validMarkers.map((marker) => (
        <Marker key={marker.id} position={[marker.lat, marker.lng]}>
          <Popup>
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-foreground">{marker.name}</p>
              {marker.price !== null && <p className="text-sm text-muted-foreground">₱{marker.price} / hour</p>}
              <Link href={marker.href} className="text-sm font-medium text-primary hover:underline">
                View court →
              </Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
