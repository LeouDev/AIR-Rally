export type LatLng = { lat: number; lng: number };

export type MapMarker = {
  id: string;
  position: LatLng;
  label?: string;
};

export interface MapProvider {
  readonly name: string;
}

/**
 * No live map provider is wired up in Phase 1 — Explore and Court Details
 * render <MapPlaceholder /> instead of a real map. Implement this interface
 * for Google Maps or Mapbox in a later phase; components already depend on
 * this module rather than a specific vendor SDK.
 */
export const activeMapProvider: MapProvider | null = null;
