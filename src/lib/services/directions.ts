/**
 * Pure, framework-agnostic helpers for the "Get Directions" button
 * (Phase 6, Part 8). `detectPlatform` takes a userAgent string rather
 * than reading `navigator` itself, so it's trivially unit-testable —
 * the call site passes `navigator.userAgent` at runtime.
 */
export type DirectionsPlatform = "ios" | "android" | "other";

export function detectPlatform(userAgent: string): DirectionsPlatform {
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (/android/i.test(userAgent)) return "android";
  return "other";
}

export type DirectionsUrls = {
  apple: string;
  google: string;
  waze: string;
};

/** `label` (the venue name) is only used by Apple Maps' `q` param — the pin's display label, not the actual destination coordinates. */
export function buildDirectionsUrls(lat: number, lng: number, label: string): DirectionsUrls {
  const coords = `${lat},${lng}`;
  const encodedLabel = encodeURIComponent(label);
  return {
    apple: `https://maps.apple.com/?daddr=${coords}&q=${encodedLabel}`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${coords}`,
    waze: `https://waze.com/ul?ll=${coords}&navigate=yes`,
  };
}

/** iOS defaults to Apple Maps (native app deep link with a graceful web fallback); Android/desktop default to Google Maps. */
export function getPreferredDirectionsUrl(urls: DirectionsUrls, platform: DirectionsPlatform): string {
  return platform === "ios" ? urls.apple : urls.google;
}
